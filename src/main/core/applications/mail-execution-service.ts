import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import { smtpConfigSchema, type ApplicationConnection, type ConnectionConfig } from '@shared/application-connections';
import { prepareMailSendSchema, type MailSendActor, type MailSendIntent, type MailSendResult, type MailSendReview, type MailSendState, type VerifiedMailUserAction } from '@shared/mail-execution';
import type { MailDraft } from '@shared/mail-drafts';
import { canonicalJson, digest } from './manifest';
import type { ResourceStore } from './resource-store';
import { withResourceLock } from './resource-lock';
import type { ApplicationConnectionService } from './connection-service';
import type { ApplicationSelectionService } from './selection-service';
import type { MailDraftService } from './mail-draft-service';
import type { MailPolicy } from './mail-blob-store';
import type { ProcessIdentity } from './process-identity';
import { prepareSmtpMessage, submitSmtp, type PreparedSmtpMessage } from './providers/smtp';

type SmtpConfig = Extract<ConnectionConfig,{ kind: 'smtp' }>;
interface IntentRow {
  id: string;project_id: string;source_task_id: string | null;source_run_id: string | null;operation_id: string;request_hash: string;
  draft_id: string;draft_revision: number;draft_content_hash: string;connection_id: string;identity_revision: number;config_revision: number;policy_revision: number;binding_revision: number;sender_identity_hash:string|null;
  identity_json: string;smtp_config_json: string;raw_write_id: string;raw_object_id: string | null;raw_hash: string | null;frozen_hash: string | null;envelope_json: string | null;message_id: string;
  review_json: string | null;review_hash: string | null;state: MailSendState;grant_id: string | null;execution_id: string | null;cancel_requested_at: string | null;
  owner_instance_id: string;owner_pid: number;owner_started_at: string;error_code: string | null;created_at: string;updated_at: string;
}
interface GrantRow { id: string;intent_id: string;source: VerifiedMailUserAction['source'];evidence_id: string;evidence_hash: string;review_hash: string;evidence_json: string;state: string;expires_at: string }
export interface MailSendPolicy extends MailPolicy {
  requireSend(actor: MailSendActor): void;
  senderIdentity?(actor:MailSendActor):string;
  authenticate(actor:MailSendActor,connection:ApplicationConnection):{config:ConnectionConfig;secret:string|null};
  verifyUserAction(actor: MailSendActor,evidenceRef: string,intent: MailSendIntent): VerifiedMailUserAction;
  allowUiAuthorization?(actor:MailSendActor,intent:MailSendIntent):boolean;
  ownerState(owner: { instanceId: string;pid: number;startedAt: string }): 'running' | 'stopped' | 'unknown';
}
export interface MailExecutionOptions {
  submit?: typeof submitSmtp;
  hostIdentity?:ProcessIdentity;
  activity?:(actor:MailSendActor,intentId:string,work:()=>Promise<unknown>)=>Promise<unknown>;
  submissionTimeoutMs?: number;
  checkpoint?: (phase: 'prepared' | 'claimed' | 'submitted',intentId: string) => void;
}
const TERMINAL = new Set<MailSendState>(['server-accepted','failed','unknown','canceled','stale']);
const envelopeSchema = z.object({ from: z.email(),to: z.array(z.email()).min(1).max(100) }).strict();
const actionSchema = z.object({ id: z.string().min(1).max(512),source: z.enum(['renderer-confirmation','native-user-message']),sourceHash: z.string().regex(/^[a-f0-9]{64}$/),intentId: z.uuid(),reviewHash: z.string().regex(/^[a-f0-9]{64}$/),projectId: z.string(),taskId: z.string().nullable(),runId: z.string().nullable(),createdAt: z.iso.datetime(),expiresAt: z.iso.datetime(),reviewedUnknownExecutionIds: z.array(z.uuid()).max(100) }).strict();

/** Host-owned orchestration. Tools supply references, never their own approval assertions. */
export class MailExecutionService {
  private readonly instanceId=randomUUID();
  private readonly running = new Map<string,AbortController>();
  private readonly preparing = new Set<string>();
  private readonly operations = new Set<Promise<MailSendIntent>>();
  private readonly shutdown = new AbortController();
  private readonly executing=new Set<string>();
  private readonly producers=new Map<string,Promise<unknown>>();
  private readonly settled=new Set<string>();
  private readonly born:string;
  constructor(readonly store: ResourceStore,private readonly drafts: MailDraftService,private readonly connections: ApplicationConnectionService,private readonly selections: ApplicationSelectionService,private readonly policy: MailSendPolicy,private readonly options: MailExecutionOptions = {}) {if(options.hostIdentity&&options.hostIdentity.pid!==process.pid)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','发送宿主进程身份不一致');this.born=options.hostIdentity?.startedAt??new Date(Date.now()-process.uptime()*1000).toISOString();}
  private row(actor: MailSendActor,id: string): IntentRow {
    this.policy.requireDrafts(actor); const row = this.store.sqlite.prepare('SELECT * FROM mail_send_intents WHERE id=? AND project_id=?').get(id,actor.projectId) as IntentRow | undefined;
    if (!row) throw new ApplicationError('NOT_FOUND','当前项目没有此发送意图'); return row;
  }
  private view(row: IntentRow): MailSendIntent {
    const review = row.review_json ? JSON.parse(row.review_json) as MailSendReview : null;
    if (review && digest(canonicalJson(review)) !== row.review_hash) throw new ApplicationError('HASH_MISMATCH','发送意图的审阅内容损坏');
    const execution = row.execution_id ? this.store.sqlite.prepare('SELECT result_json FROM mail_send_executions WHERE id=? AND intent_id=?').get(row.execution_id,row.id) as { result_json: string | null } | undefined : undefined;
    const grant = row.grant_id ? this.store.sqlite.prepare('SELECT state,expires_at FROM mail_send_grants WHERE id=?').get(row.grant_id) as { state: string;expires_at: string } | undefined : undefined;
    return { id: row.id,projectId: row.project_id,draftId: row.draft_id,draftRevision: row.draft_revision,state: row.state,review,reviewHash: row.review_hash,authorized: row.state === 'authorized' && grant?.state === 'active' && Date.parse(grant.expires_at) > Date.now(),executionId: row.execution_id,result: execution?.result_json ? JSON.parse(execution.result_json) as MailSendResult : null,cancelRequestedAt: row.cancel_requested_at,errorCode: row.error_code,createdAt: row.created_at,updatedAt: row.updated_at };
  }
  get(actor: MailSendActor,id: string): MailSendIntent { return this.view(this.row(actor,id)); }
  private origin(actor: MailSendActor,row: IntentRow): void {
    if (actor.taskId !== row.source_task_id || actor.runId !== row.source_run_id) throw new ApplicationError('SCOPE_DENIED','发送意图属于其他运行，请从当前运行重新明确操作');
  }
  private current(actor: MailSendActor): { connection: ApplicationConnection;config: SmtpConfig;bindingRevision: number;senderIdentityHash:string|null } {
    this.policy.requireSend(actor);
    const binding = this.selections.connectionSlot(actor.projectId,'mail','smtp'), id = binding.connectionId;
    if (!id) throw new ApplicationError('AUTH_REQUIRED','请先明确选用当前项目的发件连接');
    const connection = this.connections.get(id);
    if (connection.providerId !== 'smtp' || connection.config.kind !== 'smtp' || !connection.enabled || connection.authorization !== 'connected') throw new ApplicationError('AUTH_REQUIRED','当前发件连接未启用或已断开');
    return { connection,config: connection.config,bindingRevision: binding.revision,senderIdentityHash:this.policy.senderIdentity?.(actor)??null };
  }
  private assertCurrent(actor: MailSendActor,row: IntentRow,checkOrigin=true): ReturnType<MailExecutionService['current']> {
    if(checkOrigin)this.origin(actor,row); let current: ReturnType<MailExecutionService['current']>;
    try { current = this.current(actor); } catch { throw new ApplicationError('INTENT_STALE','当前应用、运行或发件授权已改变，旧发送意图失效'); }
    const c = current.connection;
    if (c.id !== row.connection_id || c.identityRevision !== row.identity_revision || c.configRevision !== row.config_revision || c.policyRevision !== row.policy_revision || current.bindingRevision !== row.binding_revision || canonicalJson(c.identity) !== row.identity_json || canonicalJson(c.config) !== row.smtp_config_json) throw new ApplicationError('INTENT_STALE','发件身份、配置或项目选用已改变，请重新明确操作');
    const draft = this.drafts.get(actor,row.draft_id);
    if (draft.revision !== row.draft_revision || draft.contentHash !== row.draft_content_hash || draft.activeIntentId !== row.id) throw new ApplicationError('INTENT_STALE','草稿或发送占用已改变，旧发送意图失效');
    return current;
  }
  private ancestry(draftId: string,projectId: string): { id: string;state: string;intent_id:string }[] {
    return this.store.sqlite.prepare(`WITH RECURSIVE ancestors(id) AS (VALUES(?) UNION SELECT d.copied_from_draft_id FROM mail_drafts d JOIN ancestors a ON a.id=d.id WHERE d.project_id=? AND d.copied_from_draft_id IS NOT NULL) SELECT e.id,e.state,e.intent_id FROM mail_send_executions e JOIN ancestors a ON a.id=e.draft_id WHERE e.project_id=? AND e.state IN ('executing','unknown')`).all(draftId,projectId,projectId) as { id: string;state: string;intent_id:string }[];
  }
  prepare(actor: MailSendActor,input: z.infer<typeof prepareMailSendSchema>,signal?: AbortSignal): Promise<MailSendIntent> {
    if (this.shutdown.signal.aborted) return Promise.reject(new ApplicationError('CANCELED','邮件服务已停止'));
    return this.track(this.prepareOnce(actor,input,AbortSignal.any(signal ? [signal,this.shutdown.signal] : [this.shutdown.signal])));
  }
  private async prepareOnce(actor: MailSendActor,input: z.infer<typeof prepareMailSendSchema>,signal?: AbortSignal): Promise<MailSendIntent> {
    const parsed = prepareMailSendSchema.safeParse(input); if (!parsed.success) throw new ApplicationError('INVALID_INPUT','发送准备参数无效，需明确草稿与内容修订');
    this.policy.requireSend(actor); if (signal?.aborted) throw new ApplicationError('CANCELED','发送准备已取消');
    const value = parsed.data, requestHash = digest(canonicalJson(value)); let row!: IntentRow, created = false;
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      this.policy.requireSend(actor);
      const existing = this.store.sqlite.prepare('SELECT * FROM mail_send_intents WHERE project_id=? AND operation_id=?').get(actor.projectId,value.operationId) as IntentRow | undefined;
      if (existing) { if (existing.request_hash !== requestHash) throw new ApplicationError('REVISION_CONFLICT','发送准备编号已用于其他内容'); this.origin(actor,existing); row = existing; return; }
      const current = this.current(actor), draft = this.drafts.get(actor,value.draftId);
      if (draft.revision !== value.expectedRevision || draft.contentHash !== value.expectedContentHash) throw new ApplicationError('REVISION_CONFLICT','草稿修订已变化，请先查看当前内容');
      if (draft.activeIntentId || ['sending','sent','unknown'].includes(draft.state)) throw new ApplicationError('DRAFT_LOCKED','此草稿已被发送意图占用或已有结果，请先查看原记录');
      if (this.store.sqlite.prepare('SELECT 1 FROM mail_send_executions WHERE draft_id=? AND draft_revision=?').get(draft.id,draft.revision)) throw new ApplicationError('EXECUTION_ALREADY_ATTEMPTED','此修订已经尝试发送，请核对原结果，不能自动生成新意图重发');
      if (this.ancestry(draft.id,actor.projectId).some(a => a.state === 'executing'||this.producers.has(a.intent_id)||Boolean(this.store.sqlite.prepare("SELECT 1 FROM capability_resource_leases WHERE owner_kind='mail-send' AND owner_id=? AND state='active'").get(a.intent_id)))) throw new ApplicationError('EXECUTION_ALREADY_ATTEMPTED','来源草稿仍在发送，请先等待并核对原结果');
      if (draft.content.senderConnectionId && draft.content.senderConnectionId !== current.connection.id) throw new ApplicationError('INTENT_STALE','草稿发件人与项目当前选用不同，请明确选择后更新草稿');
      const id = randomUUID(), now = new Date().toISOString();
      this.store.sqlite.prepare(`INSERT INTO mail_send_intents(id,project_id,source_task_id,source_run_id,operation_id,request_hash,draft_id,draft_revision,draft_content_hash,connection_id,identity_revision,config_revision,policy_revision,binding_revision,sender_identity_hash,identity_json,smtp_config_json,raw_write_id,message_id,state,owner_instance_id,owner_pid,owner_started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'preparing',?,?,?,?,?)`).run(id,actor.projectId,actor.taskId,actor.runId,value.operationId,requestHash,draft.id,draft.revision,draft.contentHash,current.connection.id,current.connection.identityRevision,current.connection.configRevision,current.connection.policyRevision,current.bindingRevision,current.senderIdentityHash,canonicalJson(current.connection.identity),canonicalJson(current.config),randomUUID(),'<wy-' + id + '@willyou.local>',this.instanceId,process.pid,this.born,now,now);
      this.store.sqlite.prepare('UPDATE mail_drafts SET active_intent_id=?,updated_at=? WHERE id=?').run(id,now,draft.id); row = this.row(actor,id); created = true; this.preparing.add(id);
    }).immediate());
    if (!created) return this.view(row);
    try {
      const draft = this.drafts.get(actor,row.draft_id,row.draft_revision), config = smtpConfigSchema.parse(JSON.parse(row.smtp_config_json));
      const frozen = await this.compose(draft,config,row.message_id,row.created_at,actor);
      const object = await this.drafts.blobs.saveMessage(actor,row.raw_write_id,frozen.raw,signal);
      await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
        if (signal?.aborted) throw new ApplicationError('CANCELED','发送准备已取消');
        const current = this.row(actor,row.id); if (current.state !== 'preparing') throw new ApplicationError('INTENT_STALE','发送准备已被取消或失效'); this.assertCurrent(actor,current);
        const review: MailSendReview = { schema: 'willyou-mail-send-v1',intentId: row.id,projectId: actor.projectId,sourceTaskId: actor.taskId,sourceRunId: actor.runId,draftId: draft.id,draftRevision: draft.revision,draftContentHash: draft.contentHash,connectionId: row.connection_id,identityRevision: row.identity_revision,configRevision: row.config_revision,policyRevision: row.policy_revision,bindingRevision: row.binding_revision,identityHash: digest(row.identity_json),smtpConfigHash: digest(row.smtp_config_json),fromAddress: config.fromAddress,content: draft.content,attachments: draft.attachments,rawHash: frozen.rawHash,frozenHash: frozen.contentHash,messageId: frozen.messageId,priorUnknownExecutionIds: this.ancestry(draft.id,actor.projectId).filter(a => a.state === 'unknown').map(a => a.id).sort() };
        this.store.sqlite.prepare("UPDATE mail_send_intents SET raw_object_id=?,raw_hash=?,frozen_hash=?,envelope_json=?,review_json=?,review_hash=?,state='awaiting-authorization',updated_at=? WHERE id=? AND state='preparing'").run(object.id,frozen.rawHash,frozen.contentHash,canonicalJson(frozen.envelope),canonicalJson(review),digest(canonicalJson(review)),new Date().toISOString(),row.id);
      }).immediate());
      this.options.checkpoint?.('prepared',row.id); return this.get(actor,row.id);
    } catch (error) {
      await this.failPreparation(row.id,error instanceof ApplicationError ? error.code : 'PREPARATION_FAILED'); throw error instanceof ApplicationError ? error : new ApplicationError('RESOURCE_RECOVERY_REQUIRED','邮件准备未完成，未提交到服务器');
    } finally { this.preparing.delete(row.id);this.settled.add(row.id); }
  }
  private compose(draft: MailDraft,config: SmtpConfig,messageId: string,date: string,actor: MailSendActor): Promise<PreparedSmtpMessage> {
    const c = draft.content;
    return prepareSmtpMessage(config,{ to: c.to,cc: c.cc,bcc: c.bcc,subject: c.subject,text: c.text,...(c.html === null ? {} : { html: c.html }),messageId,date,...(c.inReplyTo ? { inReplyTo: c.inReplyTo } : {}),references: c.references,attachments: draft.attachments.map(a => ({ filename: a.filename,contentType: a.contentType,content: this.drafts.blobs.read(actor,a.id) })) });
  }
  private async failPreparation(id: string,code: string): Promise<void> {
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const row = this.store.sqlite.prepare('SELECT state FROM mail_send_intents WHERE id=?').get(id) as { state: MailSendState } | undefined;
      if (row?.state !== 'preparing') return;
      this.store.sqlite.prepare("UPDATE mail_send_intents SET state='failed',error_code=?,updated_at=? WHERE id=?").run(code,new Date().toISOString(),id);
      this.store.sqlite.prepare('UPDATE mail_drafts SET active_intent_id=NULL WHERE active_intent_id=?').run(id);
    }).immediate());
  }
  private evidence(actor: MailSendActor,row: IntentRow,ref: string): VerifiedMailUserAction {
    let action: VerifiedMailUserAction;
    try { action = actionSchema.parse(this.policy.verifyUserAction(actor,ref,this.view(row))); }
    catch { throw new ApplicationError('AUTHORIZATION_REQUIRED','尚无可核验的用户明确指令或确认，请审阅具体目标与内容'); }
    const review = this.view(row).review;
    if (!review || action.id !== ref || action.intentId !== row.id || action.reviewHash !== row.review_hash || action.projectId !== row.project_id || action.taskId !== row.source_task_id || action.runId !== row.source_run_id || Date.parse(action.expiresAt) <= Date.now() || Date.parse(action.createdAt) > Date.now() + 5000 || Date.parse(action.expiresAt) <= Date.parse(action.createdAt)) throw new ApplicationError('AUTHORIZATION_REQUIRED','用户授权未绑定当前具体意图、运行或已失效');
    if (canonicalJson([...new Set(action.reviewedUnknownExecutionIds)].sort()) !== canonicalJson(review.priorUnknownExecutionIds)) throw new ApplicationError('AUTHORIZATION_REQUIRED','来源发送结果未知，需先核实原执行并明确新的操作');
    return action;
  }
  async authorize(actor: MailSendActor,id: string,evidenceRef: string): Promise<MailSendIntent> {
    try {
      return await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
        const row = this.row(actor,id); this.assertCurrent(actor,row,this.policy.allowUiAuthorization?.(actor,this.view(row))!==true);
        if (!['awaiting-authorization','authorized'].includes(row.state) || !row.review_hash) throw new ApplicationError('INTENT_STALE','此发送意图已取消、执行或不可授权');
        const action = this.evidence(actor,row,evidenceRef), hash = digest(canonicalJson(action));
        const old = this.store.sqlite.prepare('SELECT * FROM mail_send_grants WHERE source=? AND evidence_id=?').get(action.source,action.id) as GrantRow | undefined;
        if (old && (old.intent_id !== id || old.state !== 'active' || old.evidence_hash !== hash)) throw new ApplicationError('AUTHORIZATION_REQUIRED','此用户证据已用于其他执行或已撤销');
        const grantId = old?.id ?? randomUUID();
        if (!old) this.store.sqlite.prepare("INSERT INTO mail_send_grants(id,intent_id,source,evidence_id,evidence_hash,review_hash,evidence_json,state,expires_at,created_at) VALUES(?,?,?,?,?,?,?,'active',?,?)").run(grantId,id,action.source,action.id,hash,row.review_hash,canonicalJson(action),action.expiresAt,new Date().toISOString());
        this.store.sqlite.prepare("UPDATE mail_send_grants SET state='revoked' WHERE intent_id=? AND id<>? AND state='active'").run(id,grantId);
        this.store.sqlite.prepare("UPDATE mail_send_intents SET state='authorized',grant_id=?,updated_at=? WHERE id=?").run(grantId,new Date().toISOString(),id);
        return this.get(actor,id);
      }).immediate());
    } catch (error) { if (error instanceof ApplicationError && error.code === 'INTENT_STALE') await this.invalidate([id],'stale','INTENT_STALE'); throw error; }
  }
  private frozen(actor: MailSendActor,row: IntentRow): PreparedSmtpMessage {
    if (!row.raw_object_id || !row.raw_hash || !row.frozen_hash || !row.envelope_json || !row.review_json || !row.review_hash) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','邮件尚未完成冻结准备');
    const raw = this.drafts.blobs.readMessage(actor,row.raw_object_id), envelope = envelopeSchema.parse(JSON.parse(row.envelope_json)), review = this.view(row).review!;
    const expectedRecipients = [...new Set([...review.content.to,...review.content.cc,...review.content.bcc])];
    if (review.intentId !== row.id || review.projectId !== row.project_id || review.draftId !== row.draft_id || review.draftRevision !== row.draft_revision || review.draftContentHash !== row.draft_content_hash || review.connectionId !== row.connection_id || review.rawHash !== row.raw_hash || review.frozenHash !== row.frozen_hash || review.messageId !== row.message_id || canonicalJson(envelope) !== canonicalJson({ from: review.fromAddress,to: expectedRecipients }) || digest(raw) !== row.raw_hash || digest(canonicalJson({ rawHash: row.raw_hash,envelope,messageId: row.message_id })) !== row.frozen_hash) throw new ApplicationError('HASH_MISMATCH','冻结邮件、信封或审阅内容发生变化');
    return { raw,rawHash: row.raw_hash,contentHash: row.frozen_hash,envelope,messageId: row.message_id };
  }
  private unknown(row: IntentRow,errorCode: string): MailSendResult { return { state: 'unknown',complete: false,accepted: [],rejected: [],errorCode,smtpCode: null,messageId: row.message_id }; }
  private receipt(row: IntentRow,raw: unknown,frozen: PreparedSmtpMessage): MailSendResult {
    const parsed = z.object({ state: z.enum(['server-accepted','failed','unknown']),complete: z.boolean(),accepted: z.array(z.string()).max(100),rejected: z.array(z.string()).max(100),errorCode: z.string().nullable(),smtpCode: z.number().int().min(100).max(599).nullable(),messageId: z.string() }).strict().safeParse(raw);
    if (!parsed.success) return this.unknown(row,'INVALID_RECEIPT');
    const value = parsed.data, expected = new Set(frozen.envelope.to), accepted = [...new Set(value.accepted)], rejected = [...new Set(value.rejected)];
    if (value.messageId !== row.message_id || [...accepted,...rejected].some(a => !expected.has(a)) || accepted.some(a => rejected.includes(a)) || (value.state === 'server-accepted' && !accepted.length) || (value.state === 'failed' && accepted.length > 0)) return this.unknown(row,'INVALID_RECEIPT');
    return { ...value,accepted,rejected,complete: value.state === 'server-accepted' && rejected.length === 0 && accepted.length === expected.size,errorCode: value.errorCode && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.errorCode) ? value.errorCode : value.errorCode ? 'PROVIDER_FAILURE' : null };
  }
  execute(actor: MailSendActor,id: string,signal?:AbortSignal): Promise<MailSendIntent> {
    if (this.shutdown.signal.aborted) return Promise.reject(new ApplicationError('CANCELED','邮件服务已停止'));
    return this.track(this.executeOnce(actor,id,signal));
  }
  private track(promise: Promise<MailSendIntent>): Promise<MailSendIntent> { this.operations.add(promise); promise.then(() => this.operations.delete(promise),() => this.operations.delete(promise)); return promise; }
  async dispose(): Promise<void> {
    this.shutdown.abort();for(const controller of this.running.values())controller.abort();
    await Promise.allSettled([...this.operations,...this.producers.values()]);
    const rows=this.store.sqlite.prepare("SELECT id FROM mail_send_intents WHERE owner_instance_id=? AND state IN ('preparing','awaiting-authorization','authorized')").all(this.instanceId) as {id:string}[];
    await this.invalidate(rows.map(row=>row.id),'stale','HOST_CLOSED');
  }
  private async executeOnce(actor: MailSendActor,id: string,signal?:AbortSignal): Promise<MailSendIntent> {
    this.policy.requireSend(actor); const preliminary = this.row(actor,id); this.origin(actor,preliminary);
    if (preliminary.execution_id) return this.view(preliminary);
    const frozen = this.frozen(actor,preliminary), controller = new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();let claimed: IntentRow | null = null, credentials: { config: SmtpConfig;secret: string } | null = null;
    try {
      await withResourceLock(this.store.root,() => {
        this.store.sqlite.transaction(() => {
          const row = this.row(actor,id); this.origin(actor,row); if (row.execution_id) return;
          const current = this.assertCurrent(actor,row);
          if (row.state !== 'authorized' || !row.grant_id || row.review_hash !== preliminary.review_hash || row.raw_hash !== frozen.rawHash || row.frozen_hash !== frozen.contentHash) throw new ApplicationError('AUTHORIZATION_REQUIRED','此具体发送意图尚未授权或已发生变化');
          const grant = this.store.sqlite.prepare('SELECT * FROM mail_send_grants WHERE id=? AND intent_id=?').get(row.grant_id,row.id) as GrantRow | undefined;
          if (!grant || grant.state !== 'active' || grant.review_hash !== row.review_hash || Date.parse(grant.expires_at) <= Date.now()) throw new ApplicationError('AUTHORIZATION_REQUIRED','用户授权已失效，请重新核对同一具体动作');
          const action = this.evidence(actor,row,grant.evidence_id);
          if (action.source !== grant.source || digest(canonicalJson(action)) !== grant.evidence_hash) throw new ApplicationError('AUTHORIZATION_REQUIRED','授权证据已被撤销或变化');
          const c = current.connection, authentication = this.policy.authenticate(actor,c);
          if (!authentication.secret || authentication.config.kind !== 'smtp') throw new ApplicationError('AUTH_REQUIRED','当前发件凭据不可用');
          credentials = { config: authentication.config,secret: authentication.secret };
          const executionId = randomUUID(), now = new Date().toISOString();
          this.store.sqlite.prepare("INSERT INTO mail_send_executions(id,intent_id,project_id,draft_id,draft_revision,review_hash,state,secret_revision,owner_instance_id,started_at) VALUES(?,?,?,?,?,?,'executing',?,?,?)").run(executionId,row.id,row.project_id,row.draft_id,row.draft_revision,row.review_hash,c.secretRevision,this.instanceId,now);
          this.store.sqlite.prepare("UPDATE mail_send_grants SET state='used' WHERE id=? AND state='active'").run(grant.id);
          this.store.sqlite.prepare("UPDATE mail_send_intents SET state='executing',execution_id=?,owner_instance_id=?,owner_pid=?,owner_started_at=?,updated_at=? WHERE id=?").run(executionId,this.instanceId,process.pid,this.born,now,row.id);
          this.store.sqlite.prepare("UPDATE mail_drafts SET state='sending',last_execution_id=?,updated_at=? WHERE id=? AND active_intent_id=?").run(executionId,now,row.draft_id,row.id);
          claimed = this.row(actor,id);
        }).immediate();
        if (claimed) { this.running.set(id,controller); if (this.shutdown.signal.aborted) controller.abort(); }
      });
    } catch (error) { credentials = null;signal?.removeEventListener('abort',cancel); if (error instanceof ApplicationError && error.code === 'INTENT_STALE') await this.invalidate([id],'stale','INTENT_STALE'); throw error; }
    if (!claimed || !credentials){signal?.removeEventListener('abort',cancel);return this.get(actor,id);}
    this.executing.add(id);const row = claimed as IntentRow, auth = credentials as { config: SmtpConfig;secret: string };
    try {
      this.options.checkpoint?.('claimed',id);
      let result: MailSendResult;
      if (controller.signal.aborted) result = { ...this.unknown(row,'CANCELED_BEFORE_SUBMISSION'),state: 'failed' };
      else {
        try { result = this.receipt(row,await this.submitBounded(actor,row.id,auth.config,auth.secret,frozen,controller),frozen); }
        catch { result = this.unknown(row,'SUBMISSION_UNCONFIRMED'); }
      }
      auth.secret = ''; credentials = null;
      this.options.checkpoint?.('submitted',id);
      await this.record(row,result);
      const saved = this.store.sqlite.prepare('SELECT * FROM mail_send_intents WHERE id=?').get(id) as IntentRow;
      return this.view(saved);
    } finally { auth.secret = ''; credentials = null;signal?.removeEventListener('abort',cancel);this.executing.delete(id);if(!this.producers.has(id)){this.running.delete(id);this.settled.add(id);} }
  }
  private async submitBounded(actor:MailSendActor,id:string,config: SmtpConfig,secret: string,frozen: PreparedSmtpMessage,controller: AbortController): Promise<unknown> {
    let rejectAbort!: (error: Error) => void;
    const abort = () => rejectAbort(new ApplicationError('CANCELED','发送等待已取消，需核对实际结果'));
    const pending = new Promise<never>((_,reject) => { rejectAbort = reject; });
    controller.signal.addEventListener('abort',abort,{ once: true });
    const timer = setTimeout(() => controller.abort(),Math.max(1,Math.min(60000,this.options.submissionTimeoutMs ?? 60000)));
    const work=()=>{if(controller.signal.aborted)throw new ApplicationError('CANCELED','发送工作在提交前已取消');return Promise.resolve((this.options.submit??submitSmtp)(config,secret,frozen,controller.signal));},producer=Promise.resolve().then(()=>this.options.activity?this.options.activity(actor,id,work):work());this.producers.set(id,producer);
    void producer.finally(()=>{if(this.producers.get(id)===producer){this.producers.delete(id);if(!this.executing.has(id)){this.running.delete(id);this.settled.add(id);}}}).catch(()=>{});
    try { return await Promise.race([producer,pending]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort',abort); }
  }
  private async record(row: IntentRow,result: MailSendResult): Promise<void> {
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const now = new Date().toISOString();
      const changed = this.store.sqlite.prepare("UPDATE mail_send_executions SET state=?,result_json=?,ended_at=? WHERE id=? AND intent_id=? AND state='executing'").run(result.state,canonicalJson(result),now,row.execution_id,row.id).changes;
      if (!changed) return;
      this.store.sqlite.prepare("UPDATE mail_send_intents SET state=?,error_code=?,updated_at=? WHERE id=? AND execution_id=? AND state='executing'").run(result.state,result.errorCode,now,row.id,row.execution_id);
      this.store.sqlite.prepare('UPDATE mail_drafts SET state=?,active_intent_id=NULL,updated_at=? WHERE id=? AND active_intent_id=? AND last_execution_id=?').run(result.state === 'server-accepted' ? 'sent' : result.state,now,row.draft_id,row.id,row.execution_id);
    }).immediate());
  }
  private async invalidate(ids: string[],state: 'canceled' | 'stale',code: string): Promise<void> {
    for (const id of ids) this.running.get(id)?.abort();
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const now = new Date().toISOString();
      for (const id of ids) {
        const row = this.store.sqlite.prepare('SELECT state,grant_id FROM mail_send_intents WHERE id=?').get(id) as { state: MailSendState;grant_id: string | null } | undefined;
        if (!row || TERMINAL.has(row.state)) continue;
        if (row.state === 'executing') { this.store.sqlite.prepare('UPDATE mail_send_intents SET cancel_requested_at=?,updated_at=? WHERE id=?').run(now,now,id); continue; }
        this.store.sqlite.prepare('UPDATE mail_send_intents SET state=?,error_code=?,updated_at=? WHERE id=?').run(state,code,now,id);
        if (row.grant_id) this.store.sqlite.prepare("UPDATE mail_send_grants SET state='revoked' WHERE id=? AND state='active'").run(row.grant_id);
        this.store.sqlite.prepare('UPDATE mail_drafts SET active_intent_id=NULL,updated_at=? WHERE active_intent_id=?').run(now,id);
      }
    }).immediate());
  }
  async cancel(actor: MailSendActor,id: string): Promise<MailSendIntent> { this.row(actor,id); await this.invalidate([id],'canceled','USER_CANCELED'); return this.get(actor,id); }
  async invalidateRun(runId: string): Promise<void> { const ids = this.store.sqlite.prepare('SELECT id FROM mail_send_intents WHERE source_run_id=?').all(runId) as { id: string }[]; await this.invalidate(ids.map(r => r.id),'stale','RUN_ENDED'); }
  async invalidateConnection(id: string): Promise<void> { const ids = this.store.sqlite.prepare('SELECT id FROM mail_send_intents WHERE connection_id=?').all(id) as { id: string }[]; await this.invalidate(ids.map(r => r.id),'stale','CONNECTION_REVOKED'); }
  /** Recheck public policy only; never decrypt credentials or probe native processes inside C. */
  async invalidatePolicies():Promise<void>{
    const rows=this.store.sqlite.prepare("SELECT * FROM mail_send_intents WHERE state IN ('preparing','awaiting-authorization','authorized','executing')").all() as IntentRow[];
    const ids=rows.filter(row=>{try{const binding=this.selections.connectionSlot(row.project_id,'mail','smtp'),connection=this.connections.get(row.connection_id);return binding.connectionId!==row.connection_id||binding.revision!==row.binding_revision||!connection.enabled||connection.authorization!=='connected'||connection.identityRevision!==row.identity_revision||connection.configRevision!==row.config_revision||connection.policyRevision!==row.policy_revision||canonicalJson(connection.identity)!==row.identity_json||canonicalJson(connection.config)!==row.smtp_config_json;}catch{return true;}}).map(row=>row.id);
    await this.invalidate(ids,'stale','POLICY_CHANGED');
  }
  /** Never resumes a submission. Only proven stopped owners may have an interrupted operation finalized. */
  async recover(): Promise<{ recovered: string[];pending: string[] }> {
    const result = { recovered: [] as string[],pending: [] as string[] };
    const candidates=this.store.sqlite.prepare("SELECT * FROM mail_send_intents i WHERE state IN ('preparing','awaiting-authorization','authorized','executing') OR EXISTS(SELECT 1 FROM capability_resource_leases l WHERE l.owner_kind='mail-send' AND l.owner_id=i.id AND l.state='active')").all() as IntentRow[],states=new Map<string,'running'|'stopped'|'unknown'>();
    // Kernel identity queries and provider settlement checks precede the C/DB write boundary.
    for(const row of candidates){const owned=row.owner_instance_id===this.instanceId;states.set(row.id,owned&&(this.preparing.has(row.id)||this.running.has(row.id)||this.producers.has(row.id))?'running':owned&&this.settled.has(row.id)&&!['awaiting-authorization','authorized'].includes(row.state)?'stopped':this.policy.ownerState({instanceId:row.owner_instance_id,pid:row.owner_pid,startedAt:row.owner_started_at}));}
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      for (const observed of candidates) {
        const row=this.store.sqlite.prepare('SELECT * FROM mail_send_intents WHERE id=?').get(observed.id) as IntentRow|undefined;
        if(!row||row.state!==observed.state||row.owner_instance_id!==observed.owner_instance_id||row.owner_pid!==observed.owner_pid||row.owner_started_at!==observed.owner_started_at||row.execution_id!==observed.execution_id||row.updated_at!==observed.updated_at)continue;
        const owned=row.owner_instance_id===this.instanceId,live=owned&&(this.preparing.has(row.id)||this.running.has(row.id)||this.producers.has(row.id))?'running':states.get(row.id)!;
        if (live !== 'stopped') { result.pending.push(row.id); continue; }
        const now = new Date().toISOString();
        if (row.state === 'preparing') {
          this.store.sqlite.prepare("UPDATE mail_send_intents SET state='failed',error_code='PREPARATION_INTERRUPTED',updated_at=? WHERE id=?").run(now,row.id);
          this.store.sqlite.prepare('UPDATE mail_drafts SET active_intent_id=NULL,updated_at=? WHERE active_intent_id=?').run(now,row.id);
        } else if(row.state==='awaiting-authorization'||row.state==='authorized') {
          this.store.sqlite.prepare("UPDATE mail_send_intents SET state='stale',error_code='HOST_INTERRUPTED',updated_at=? WHERE id=?").run(now,row.id);
          if(row.grant_id)this.store.sqlite.prepare("UPDATE mail_send_grants SET state='revoked' WHERE id=? AND state='active'").run(row.grant_id);
          this.store.sqlite.prepare('UPDATE mail_drafts SET active_intent_id=NULL,updated_at=? WHERE active_intent_id=?').run(now,row.id);
        } else if(row.state==='executing') {
          const unknown = this.unknown(row,'HOST_INTERRUPTED');
          this.store.sqlite.prepare("UPDATE mail_send_executions SET state='unknown',result_json=?,ended_at=? WHERE id=? AND state='executing'").run(canonicalJson(unknown),now,row.execution_id);
          this.store.sqlite.prepare("UPDATE mail_send_intents SET state='unknown',error_code='HOST_INTERRUPTED',updated_at=? WHERE id=?").run(now,row.id);
          this.store.sqlite.prepare("UPDATE mail_drafts SET state='unknown',active_intent_id=NULL,updated_at=? WHERE active_intent_id=? AND last_execution_id=?").run(now,row.id,row.execution_id);
        }
        this.store.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE owner_kind='mail-send' AND owner_id=? AND pid=? AND process_started_at=? AND state='active'").run(now,row.id,row.owner_pid,row.owner_started_at);
        result.recovered.push(row.id);
      }
    }).immediate()); return result;
  }
}
