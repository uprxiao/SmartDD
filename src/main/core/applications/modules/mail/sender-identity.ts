import {basename,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import type {MailSenderIdentityStatus} from '@shared/mail-sender-identity';
import type {ApplicationConnection} from '@shared/application-connections';
import type {ApplicationConnectionService} from '../../connection-service';
import type {ApplicationSelectionService} from '../../selection-service';
import type {ApplicationExecutionContext,ApplicationExecutionContexts} from '../../execution-context';
import type {ResourceStore} from '../../resource-store';
import {canonicalJson,digest} from '../../manifest';
import {withResourceLock} from '../../resource-lock';
interface ConfirmationRow {project_id:string;binding_hash:string;binding_json:string;method:'automatic'|'user';receipt_id:string;sender_id:string|null;confirmed_at:string;record_hash:string}
interface Binding {projectId:string;smtp:Record<string,unknown>;foxmail:Record<string,unknown>|null;fromAddress:string;accountDirectory:string|null;eligibility:'automatic'|'user'|'mismatch'}
const confirmationSchema=z.object({expectedBindingHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict();
export const foxmailAccountDirectory=(sourcePath:string):string=>basename(basename(sourcePath).toLowerCase()==='messages.db'?dirname(sourcePath):sourcePath);
const revision=(connection:ApplicationConnection)=>({id:connection.id,revision:connection.revision,identityRevision:connection.identityRevision,configRevision:connection.configRevision,secretRevision:connection.secretRevision,policyRevision:connection.policyRevision,enabled:connection.enabled,authorization:connection.authorization});
/** Mail policy, never connection authentication. Reading status cannot mint a confirmation. */
export class MailSenderIdentity {
  constructor(private readonly store:ResourceStore,private readonly connections:ApplicationConnectionService,private readonly selections:ApplicationSelectionService,private readonly contexts:ApplicationExecutionContexts){}
  private binding(projectId:string,proposed?:Readonly<Record<string,string|null|undefined>>):Binding|null{
    const selection=this.selections.projectView(projectId,'mail');
    if(selection.repair&&!proposed)throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','请先修复项目邮件连接选择');
    const slots=proposed??selection.connections,smtpId=slots.smtp;if(!smtpId)return null;
    const smtp=this.connections.get(smtpId);
    if(smtp.appId!=='mail'||smtp.config.kind!=='smtp')throw new ApplicationError('SCOPE_DENIED','发件连接不属于邮件SMTP槽');
    const fromAddress=smtp.config.fromAddress.toLowerCase();let foxmail:Binding['foxmail']=null,accountDirectory:string|null=null,eligibility:Binding['eligibility']='user';
    if(slots.foxmail){
      const source=this.connections.get(slots.foxmail);if(source.appId!=='mail'||source.config.kind!=='foxmail')throw new ApplicationError('SCOPE_DENIED','本地来源不属于邮件读取槽');
      // The editable account field is deliberately excluded from address comparison.
      accountDirectory=foxmailAccountDirectory(source.config.sourcePath);const mailbox=z.email().safeParse(accountDirectory);
      if(mailbox.success)eligibility=mailbox.data.toLowerCase()===fromAddress?'automatic':'mismatch';
      foxmail={...revision(source),bindingRevision:selection.slotRevisions.foxmail??0,accountDirectory};
    }
    return{projectId,smtp:{...revision(smtp),bindingRevision:selection.slotRevisions.smtp??0},foxmail,fromAddress,accountDirectory,eligibility};
  }
  private record(projectId:string):ConfirmationRow|undefined{
    const row=this.store.sqlite.prepare('SELECT * FROM mail_sender_confirmations WHERE project_id=?').get(projectId) as ConfirmationRow|undefined;
    if(row){const{record_hash,...content}=row;if(record_hash!==digest(canonicalJson(content)))throw new ApplicationError('HASH_MISMATCH','发件身份确认记录无法核验，请重新核查原记录');}
    return row;
  }
  status(projectId:string):MailSenderIdentityStatus{
    const binding=this.binding(projectId),record=this.record(projectId);
    if(!binding)return{state:'unconfigured',bindingHash:null,fromAddress:null,accountDirectory:null,method:null,confirmedAt:null,receiptId:null,canConfirm:false,message:'尚未选用SMTP发件账号。'};
    const hash=digest(canonicalJson(binding)),base={bindingHash:hash,fromAddress:binding.fromAddress,accountDirectory:binding.accountDirectory};
    if(binding.eligibility==='mismatch')return{...base,state:'mismatch',method:null,confirmedAt:null,receiptId:null,canConfirm:false,message:'Foxmail账号目录邮箱与SMTP发件地址不一致，请更换匹配的连接；不能用用户确认覆盖。'};
    if(record?.binding_hash===hash){return{...base,state:record.method==='automatic'?'automatic':'confirmed',method:record.method,confirmedAt:record.confirmed_at,receiptId:record.receipt_id,canConfirm:false,message:record.method==='automatic'?'来源账号目录与发件地址一致，已自动确认。':'已在项目页面确认此SMTP地址为本人发件身份。'};}
    return{...base,state:record?'invalidated':'needs-confirmation',method:null,confirmedAt:null,receiptId:null,canConfirm:true,message:record?'绑定连接或修订已变化，需要重新确认发件身份。':binding.eligibility==='automatic'?'来源账号目录与发件地址一致，保存项目选用后自动确认。':'请确认该SMTP发件地址是你的发件身份。'};
  }
  validateSelection(projectId:string,slots:Readonly<Record<string,string|null|undefined>>):void{
    if(this.binding(projectId,slots)?.eligibility==='mismatch')throw new ApplicationError('SENDER_IDENTITY_MISMATCH','Foxmail账号目录邮箱与SMTP发件地址不一致，不能保存这组发件身份');
  }
  afterSelection(projectId:string):void{
    const binding=this.binding(projectId);if(!binding||binding.eligibility!=='automatic')return;
    const status=this.status(projectId);// A changed binding must retain the previous receipt until an explicit
    // reconfirmation. Matching addresses only auto-confirm the first selection.
    if(status.state==='needs-confirmation')this.write(binding,'automatic',null);
  }
  private write(binding:Binding,method:ConfirmationRow['method'],senderId:string|null):void{
    const row={project_id:binding.projectId,binding_hash:digest(canonicalJson(binding)),binding_json:canonicalJson(binding),method,receipt_id:randomUUID(),sender_id:senderId,confirmed_at:new Date().toISOString()},hash=digest(canonicalJson(row));
    this.store.sqlite.prepare('INSERT INTO mail_sender_confirmations(project_id,binding_hash,binding_json,method,receipt_id,sender_id,confirmed_at,record_hash) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET binding_hash=excluded.binding_hash,binding_json=excluded.binding_json,method=excluded.method,receipt_id=excluded.receipt_id,sender_id=excluded.sender_id,confirmed_at=excluded.confirmed_at,record_hash=excluded.record_hash').run(row.project_id,row.binding_hash,row.binding_json,row.method,row.receipt_id,row.sender_id,row.confirmed_at,hash);
  }
  async confirm(context:ApplicationExecutionContext,senderId:string,input:unknown):Promise<MailSenderIdentityStatus>{
    this.contexts.assertActive(context);
    if(context.callerKind!=='ui'||context.scopeKind!=='connection-management'||context.appId!=='mail'||context.action!=='application.project.action'||!context.projectId)throw new ApplicationError('SCOPE_DENIED','只有真实项目页面可以确认发件身份');
    const parsed=confirmationSchema.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','请明确核对当前发件地址后确认');
    return withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
      this.contexts.assertActive(context);const binding=this.binding(context.projectId!);if(!binding)throw new ApplicationError('AUTH_REQUIRED','请先明确选用SMTP发件账号');
      if(binding.eligibility==='mismatch')throw new ApplicationError('SENDER_IDENTITY_MISMATCH','来源邮箱与发件地址不一致，不能用用户确认覆盖');
      if(digest(canonicalJson(binding))!==parsed.data.expectedBindingHash)throw new ApplicationError('REVISION_CONFLICT','确认期间发件身份或连接修订已变化，请重新载入');
      this.write(binding,binding.eligibility==='automatic'?'automatic':'user',binding.eligibility==='automatic'?null:senderId);return this.status(context.projectId!);
    }).immediate());
  }
  requireConfirmed(projectId:string,expectedConnectionId?:string|null):string{
    const binding=this.binding(projectId),status=this.status(projectId);
    if(binding?.eligibility==='mismatch')throw new ApplicationError('SENDER_IDENTITY_MISMATCH',status.message);
    if(!binding)throw new ApplicationError('AUTH_REQUIRED','请先明确选用SMTP发件账号');
    if(expectedConnectionId&&binding.smtp.id!==expectedConnectionId)throw new ApplicationError('SCOPE_DENIED','所选草稿发件身份不是当前项目SMTP连接');
    if(!binding.smtp.enabled||binding.smtp.authorization!=='connected')throw new ApplicationError('AUTH_REQUIRED','当前SMTP发件账号已停用或断开');
    if(!['automatic','confirmed'].includes(status.state))throw new ApplicationError('SENDER_IDENTITY_REQUIRED',status.message);
    return digest(canonicalJson({bindingHash:status.bindingHash,receiptId:status.receiptId}));
  }
}
