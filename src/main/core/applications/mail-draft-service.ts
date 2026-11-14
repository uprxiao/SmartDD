import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import { draftContentSchema, draftCreateSchema, draftUpdateSchema, type MailActor, type MailAttachment, type MailDraft, type MailDraftContent, type MailDraftSummary } from '@shared/mail-drafts';
import { canonicalJson, digest } from './manifest';
import { withResourceLock } from './resource-lock';
import type { MailBlobStore, MailPolicy } from './mail-blob-store';
import type { ResourceStore } from './resource-store';
interface DraftRow { id: string; project_id: string; source_task_id: string | null; copied_from_draft_id: string | null; current_revision: number; state: MailDraft['state']; active_intent_id: string | null; last_execution_id: string | null; created_at: string; updated_at: string }
interface RevisionRow { content_json: string; content_hash: string }
/** This value is computed from immutable attachment metadata, never an ambient file path. */
export function draftContentHash(content: MailDraftContent,attachments: MailAttachment[]): string {
  return digest(canonicalJson({ content,attachments: attachments.map(a => ({ id: a.id,filename: a.filename,contentType: a.contentType,size: a.size,contentHash: a.contentHash })) }));
}
export class MailDraftService {
  private writeAccess(actor:MailActor){this.policy.requireDrafts(actor);this.policy.requireWrite?.(actor);}
  constructor(readonly store: ResourceStore,readonly blobs: MailBlobStore,private readonly policy: MailPolicy) {}
  private row(actor: MailActor,id: string): DraftRow {
    this.policy.requireDrafts(actor); const row = this.store.sqlite.prepare('SELECT * FROM mail_drafts WHERE id=? AND project_id=?').get(id,actor.projectId) as DraftRow | undefined;
    if (!row) throw new ApplicationError('NOT_FOUND','当前项目没有此草稿'); return row;
  }
  get(actor: MailActor,id: string,revision?: number): MailDraft {
    const row = this.row(actor,id), version = revision ?? row.current_revision;
    const saved = this.store.sqlite.prepare('SELECT content_json,content_hash FROM mail_draft_revisions WHERE draft_id=? AND revision=?').get(id,version) as RevisionRow | undefined;
    if (!saved) throw new ApplicationError('NOT_FOUND','此草稿修订不存在');
    let content: MailDraftContent; try { content = draftContentSchema.parse(JSON.parse(saved.content_json)); } catch { throw new ApplicationError('RESOURCE_STATE_CHANGED','草稿数据损坏或契约不兼容'); }
    const attachments = content.attachmentIds.map(id => this.blobs.get(actor,id));
    if (draftContentHash(content,attachments) !== saved.content_hash) throw new ApplicationError('HASH_MISMATCH','草稿或附件登记摘要不一致');
    return { id: row.id,projectId: row.project_id,sourceTaskId: row.source_task_id,copiedFromDraftId: row.copied_from_draft_id,revision: version,state: row.state,activeIntentId: row.active_intent_id,lastExecutionId: row.last_execution_id,content,contentHash: saved.content_hash,attachments,createdAt: row.created_at,updatedAt: row.updated_at };
  }
  list(actor: MailActor,limit = 50,cursor?: { updatedAt: string; id: string },state?:MailDraft['state'],manualSentDraftIds:readonly string[]=[]): { items: MailDraftSummary[]; nextCursor: { updatedAt: string; id: string } | null; stateCounts:Record<MailDraft['state'],number> } {
    this.policy.requireDrafts(actor);
    if(manualSentDraftIds.some(id=>!z.uuid().safeParse(id).success))throw new ApplicationError('INVALID_INPUT','人工核实草稿身份无效');
    if(state!==undefined&&!['draft','sending','sent','failed','unknown'].includes(state))throw new ApplicationError('INVALID_INPUT','草稿状态筛选无效');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (cursor && (!z.iso.datetime().safeParse(cursor.updatedAt).success || !z.uuid().safeParse(cursor.id).success))) throw new ApplicationError('INVALID_INPUT','草稿分页参数无效');
    const relation="(SELECT *,CASE WHEN state='unknown' AND id IN(SELECT value FROM json_each(?)) THEN 'sent' ELSE state END AS display_state FROM mail_drafts WHERE project_id=?)",scope=[JSON.stringify(manualSentDraftIds),actor.projectId];
    const rows = this.store.sqlite.prepare(`SELECT id,project_id AS projectId,current_revision AS revision,display_state AS state,subject,attachment_count AS attachmentCount,created_at AS createdAt,updated_at AS updatedAt FROM ${relation} WHERE 1=1 ${state ? 'AND display_state=?' : ''} ${cursor ? 'AND (updated_at < ? OR (updated_at = ? AND id < ?))' : ''} ORDER BY updated_at DESC,id DESC LIMIT ?`).all(...scope,...(state?[state]:[]),...(cursor?[cursor.updatedAt,cursor.updatedAt,cursor.id]:[]),limit+1) as MailDraftSummary[];
    const stateCounts:Record<MailDraft['state'],number>={draft:0,sending:0,sent:0,failed:0,unknown:0};
    for(const value of this.store.sqlite.prepare(`SELECT display_state AS state,count(*) AS n FROM ${relation} GROUP BY display_state`).all(...scope) as {state:MailDraft['state'];n:number}[])if(Object.hasOwn(stateCounts,value.state))stateCounts[value.state]=value.n;
    const items = rows.slice(0,limit), last = items.at(-1); return { items,stateCounts,nextCursor: rows.length > limit && last ? { updatedAt: last.updatedAt,id: last.id } : null };
  }
  private content(actor: MailActor,input: unknown): MailDraftContent {
    const parsed = draftContentSchema.safeParse(input); if (!parsed.success) throw new ApplicationError('INVALID_INPUT','草稿字段无效；可保存未填写完整的收件人与正文');
    for (const id of parsed.data.attachmentIds) this.blobs.read(actor,id);
    return parsed.data;
  }
  private prior(actor: MailActor,operationId: string,requestHash: string): MailDraft | null {
    const row = this.store.sqlite.prepare('SELECT request_hash,result_json FROM mail_draft_mutations WHERE project_id=? AND operation_id=?').get(actor.projectId,operationId) as { request_hash: string;result_json: string } | undefined;
    if (!row) return null;
    if (row.request_hash !== requestHash) throw new ApplicationError('REVISION_CONFLICT','草稿操作编号已用于其他内容'); return JSON.parse(row.result_json) as MailDraft;
  }
  private receipt(actor: MailActor,operationId: string,requestHash: string,value: MailDraft): void {
    this.store.sqlite.prepare('INSERT INTO mail_draft_mutations(project_id,operation_id,request_hash,draft_id,result_json,created_at) VALUES(?,?,?,?,?,?)').run(actor.projectId,operationId,requestHash,value.id,canonicalJson(value),new Date().toISOString());
  }
  private insert(actor: MailActor,operationId: string,content: MailDraftContent,requestHash: string,copiedFrom: string | null): MailDraft {
    const prior = this.prior(actor,operationId,requestHash); if (prior) return prior;
    const id = randomUUID(), now = new Date().toISOString(), attachments = content.attachmentIds.map(id => this.blobs.get(actor,id)), hash = draftContentHash(content,attachments);
    this.store.sqlite.prepare("INSERT INTO mail_drafts(id,project_id,source_task_id,copied_from_draft_id,subject,attachment_count,current_revision,state,created_at,updated_at) VALUES(?,?,?,?,?,?,1,'draft',?,?)").run(id,actor.projectId,actor.taskId,copiedFrom,content.subject,attachments.length,now,now);
    this.store.sqlite.prepare('INSERT INTO mail_draft_revisions(draft_id,revision,content_json,content_hash,actor_task_id,created_at) VALUES(?,1,?,?,?,?)').run(id,canonicalJson(content),hash,actor.taskId,now);
    const result = this.get(actor,id); this.receipt(actor,operationId,requestHash,result); return result;
  }
  async create(actor: MailActor,input: z.infer<typeof draftCreateSchema>): Promise<MailDraft> {
    this.writeAccess(actor); const parsed = draftCreateSchema.safeParse(input); if (!parsed.success) throw new ApplicationError('INVALID_INPUT','草稿创建参数无效');
    const value = parsed.data, content = this.content(actor,value.content), requestHash = digest(canonicalJson({ method: 'create',content }));
    return withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => { this.writeAccess(actor); return this.insert(actor,value.operationId,content,requestHash,null); }).immediate());
  }
  async update(actor: MailActor,input: z.infer<typeof draftUpdateSchema>): Promise<MailDraft> {
    this.writeAccess(actor); const parsed = draftUpdateSchema.safeParse(input); if (!parsed.success) throw new ApplicationError('INVALID_INPUT','草稿更新参数无效');
    const value = parsed.data, content = this.content(actor,value.content), requestHash = digest(canonicalJson({ method: 'update',draftId: value.draftId,expectedRevision: value.expectedRevision,content }));
    return withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      this.writeAccess(actor); const prior = this.prior(actor,value.operationId,requestHash); if (prior) return prior;
      const row = this.row(actor,value.draftId);
      if (row.current_revision !== value.expectedRevision) throw new ApplicationError('REVISION_CONFLICT','草稿已由其他Agent或页面修改，当前修订为' + row.current_revision + '，请重新载入');
      if (['sending','sent','unknown'].includes(row.state) || row.active_intent_id) throw new ApplicationError('DRAFT_LOCKED',row.state === 'sent' ? '已提交的内容保持不变，请复制为新草稿再编辑' : '草稿已被发送意图占用，请先查看结果或取消未执行的意图');
      const revision = row.current_revision + 1, now = new Date().toISOString(), hash = draftContentHash(content,content.attachmentIds.map(id => this.blobs.get(actor,id)));
      this.store.sqlite.prepare('INSERT INTO mail_draft_revisions(draft_id,revision,content_json,content_hash,actor_task_id,created_at) VALUES(?,?,?,?,?,?)').run(row.id,revision,canonicalJson(content),hash,actor.taskId,now);
      this.store.sqlite.prepare("UPDATE mail_drafts SET current_revision=?,subject=?,attachment_count=?,state='draft',updated_at=? WHERE id=? AND current_revision=?").run(revision,content.subject,content.attachmentIds.length,now,row.id,row.current_revision);
      const result = this.get(actor,row.id); this.receipt(actor,value.operationId,requestHash,result); return result;
    }).immediate());
  }
  /** Prepared only by host code; the closure is usable solely inside its caller's transaction. */
  prepareCopyAsNew(actor: MailActor,sourceId: string,expectedRevision: number,operationId: string):()=>MailDraft {
    this.writeAccess(actor); if (!z.uuid().safeParse(operationId).success || !z.uuid().safeParse(sourceId).success || !Number.isInteger(expectedRevision) || expectedRevision < 1) throw new ApplicationError('INVALID_INPUT','草稿复制参数无效');
    const original = this.get(actor,sourceId,expectedRevision), content = this.content(actor,original.content), requestHash = digest(canonicalJson({ method: 'copyAsNew',sourceId,expectedRevision,contentHash: original.contentHash }));
    return()=>{if(!this.store.sqlite.inTransaction)throw new ApplicationError('SCOPE_DENIED','草稿复制必须与本次操作原子提交');this.writeAccess(actor);if(this.get(actor,sourceId,expectedRevision).contentHash!==original.contentHash)throw new ApplicationError('HASH_MISMATCH','原草稿内容已变化');return this.insert(actor,operationId,content,requestHash,sourceId);};
  }
  async copyAsNew(actor: MailActor,sourceId: string,expectedRevision: number,operationId: string): Promise<MailDraft> {
    const copy=this.prepareCopyAsNew(actor,sourceId,expectedRevision,operationId);
    return withResourceLock(this.store.root,() => this.store.sqlite.transaction(copy).immediate());
  }
}
