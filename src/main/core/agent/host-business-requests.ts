import type { ApplicationUiSender } from '../applications/execution-context';
// T1.5 §8.1: task-owned business intent. Waiting is durable and has no deadline;
// execution gets a new deadline only after a current, trusted UI decision.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentStore, sha256, type RequestRow } from './agent-store';
import { DriverError } from './driver';
import type { RunHandle } from './agent-run-service';
const now = () => new Date().toISOString();
export interface BusinessOrigin { taskId: string; bindingId: string; runId: string; generation: number }
export interface BusinessPayload {
  businessKind: string; title: string; review: unknown; data: unknown;
  phase: 'waiting_user' | 'approved_pending_bind' | 'executing' | 'finished' | 'failed' | 'unknown';
  options?: { label: string; value: string }[];
  decision?: unknown; executionStartedAt?: string; resultItemId?: string;
}
export interface BusinessRecord { row: RequestRow & { operation_id: string; review_hash: string; account_identity: string | null }; origin: BusinessOrigin; payload: BusinessPayload }
export interface BusinessHandler {
  /** Recheck current task, content, accounts, policy and resource revisions. Old run liveness is irrelevant. */
  validate(record: BusinessRecord, decision: unknown, run?: RunHandle): Promise<void>;
  present?(record:BusinessRecord,sender:ApplicationUiSender):Promise<unknown>;
  revise?(record:BusinessRecord,decision:unknown,sender:ApplicationUiSender):Promise<{review:unknown;data:unknown;accountIdentity?:string}>;
  /** Browser authorization uses this when its actual owner has exited. */
  needsRun?: boolean;
  execute(record: BusinessRecord, decision: unknown, context: { signal: AbortSignal; deadline: number; run?: RunHandle; sender?:ApplicationUiSender }): Promise<unknown>;
  stop?(taskId:string):void;
  retire?(record: BusinessRecord): void | Promise<void>;
}
export class HostBusinessRequests {
  private readonly inflight=new Set<Promise<unknown>>();
  private handlers = new Map<string, BusinessHandler>();
  private executing = new Map<string, AbortController>();
  private deciding = new Set<string>();
  private closed = false;private reconciling=false;
  constructor(private readonly d: {
    store: AgentStore; run(taskId: string): RunHandle | undefined;
    /** Includes a closing owner; normal turn-end is not equivalent to no owner. */
    hasOwner(taskId: string): boolean;
    notify(taskId: string, id: string, text: string, wake: boolean): void;
    acquire?(taskId: string, operationId: string, signal: AbortSignal): Promise<() => void>;
    executionMs?: number;
  }) {
    // No automatic replay of an external effect whose host died mid-execution.
    for (const row of d.store.sqlite.prepare("SELECT * FROM agent_requests WHERE class='host_business' AND status='pending'").all() as RequestRow[]) {
      const p = JSON.parse(row.payload_ref) as BusinessPayload;
      if (p.phase === 'executing') this.d.store.tx(emit => {
        this.d.store.sqlite.prepare("UPDATE agent_requests SET payload_ref=?,status='resolved',revision=revision+1,updated_at=? WHERE request_id=? AND status='pending'").run(JSON.stringify({ ...p, phase: 'unknown' }), now(), row.request_id);
        this.d.store.addHostItem(row.task_id, null, 'notification', { sourceKind: 'system', title: p.title, status: 'unknown', summary: '宿主在业务执行期间退出，结果未知；请核对已有执行记录，不会自动重放。', requestId: row.request_id });
        emit(row.task_id, 'request.resolved', { requestId: row.request_id });
      });
    }
  }
  register(kind: string, handler: BusinessHandler) { if (this.handlers.has(kind)) throw new Error(`重复的业务请求处理器：${kind}`); this.handlers.set(kind, handler); }
  private record(id: string): BusinessRecord {
    const row = this.d.store.request(id) as BusinessRecord['row'] | undefined;
    if (!row || row.class !== 'host_business') throw new DriverError('REJECTED', '不是宿主业务请求');
    const payload = JSON.parse(row.payload_ref) as BusinessPayload, origin = JSON.parse(row.origin_json) as BusinessOrigin;
    if (origin.taskId !== row.task_id || sha256(JSON.stringify(payload.review)) !== row.review_hash) throw new DriverError('REJECTED', '业务审阅内容或来源已损坏');
    return { row, payload, origin };
  }
  private stopped(taskId: string) {
    const event = this.d.store.sqlite.prepare("SELECT event_type FROM agent_events WHERE task_id=? AND event_type IN ('task.user_stopped','task.user_continued') ORDER BY seq DESC LIMIT 1").get(taskId) as { event_type: string } | undefined;
    return event?.event_type === 'task.user_stopped';
  }
  private current(record: BusinessRecord) {
    const task = this.d.store.task(record.row.task_id);
    if (this.closed || !task || task.archived_at || this.stopped(task.id)) throw new DriverError('REJECTED', '任务已经停止、归档或不存在，请重新发起请求');
    if (task.project_id) {
      const project = this.d.store.sqlite.prepare('SELECT archived_at FROM projects WHERE id=?').get(task.project_id) as { archived_at: number | null } | undefined;
      if (!project || project.archived_at !== null) throw new DriverError('REJECTED', '项目已删除或归档');
    }
    const fresh = this.record(record.row.request_id);
    if (fresh.row.revision !== record.row.revision || !['pending','approved_pending_bind'].includes(fresh.row.status)) throw new DriverError('REJECTED', '请求已更新或结束');
  }
  create(origin: BusinessOrigin, input: { operationId: string; kind: string; title: string; review: unknown; data: unknown; accountIdentity?: string; options?: BusinessPayload['options'] }) {
    z.uuid().parse(input.operationId);
    const run = this.d.store.run(origin.runId), task = this.d.store.task(origin.taskId);
    if (!task || task.archived_at || !run || run.task_id !== origin.taskId || run.binding_id !== origin.bindingId || run.generation !== origin.generation || run.state !== 'active' || this.stopped(origin.taskId)) throw new DriverError('REJECTED', '业务请求来源不是当前登记运行');
    if (!this.handlers.has(input.kind)) throw new DriverError('UNSUPPORTED', '宿主尚不支持该业务确认');
    const payload: BusinessPayload = { businessKind: input.kind, title: input.title, review: input.review, data: input.data, phase: 'waiting_user', ...(input.options ? { options: input.options } : {}) };
    if (Buffer.byteLength(JSON.stringify(payload)) > 1024 * 1024) throw new DriverError('REJECTED', '业务请求超过审阅保存上限，请缩小范围');
    const reviewHash = sha256(JSON.stringify(payload.review));
    return this.d.store.tx(emit => {
      const old = this.d.store.sqlite.prepare("SELECT request_id,review_hash,origin_json FROM agent_requests WHERE class='host_business' AND operation_id=?").get(input.operationId) as { request_id: string; review_hash: string; origin_json: string } | undefined;
      if (old) { if (old.review_hash !== reviewHash || old.origin_json !== JSON.stringify(origin)) throw new DriverError('REJECTED', '相同业务编号已用于其他请求'); return { requestId: old.request_id, operationId: input.operationId, state: 'awaiting_user' as const, duplicate: true }; }
      const id = randomUUID();
      this.d.store.sqlite.prepare("INSERT INTO agent_requests(request_id,task_id,class,origin_json,kind,payload_ref,status,operation_id,review_hash,account_identity,created_at,updated_at) VALUES(?,?,'host_business',?,?,?,'pending',?,?,?,?,?)").run(id, origin.taskId, JSON.stringify(origin), 'host_business', JSON.stringify(payload), input.operationId, reviewHash, input.accountIdentity ?? null, now(), now());
      emit(origin.taskId, 'request.opened', { requestId: id, kind: 'host_business', origin });
      return { requestId: id, operationId: input.operationId, state: 'awaiting_user' as const, duplicate: false };
    });
  }
  async respond(taskId: string, requestId: string, revision: number, decision: unknown,sender?:ApplicationUiSender) {
    const record = this.record(requestId);
    if (record.row.task_id !== taskId || record.row.revision !== revision || !['pending','approved_pending_bind'].includes(record.row.status) || !['waiting_user','approved_pending_bind'].includes(record.payload.phase) || this.deciding.has(requestId)) throw new DriverError('REJECTED', '请求已更新、已处理或正在处理');
    this.deciding.add(requestId);
    try {
      const choice = z.object({ choice: z.string().max(128),displayReceiptId:z.uuid().optional(),reviewedUnknownExecutionIds:z.array(z.uuid()).max(100).optional(),instructions:z.string().max(16000).optional(),edits:z.object({to:z.string().max(8000),cc:z.string().max(8000),bcc:z.string().max(8000),subject:z.string().max(2000),text:z.string().max(512*1024)}).strict().optional() }).strict().parse(decision);
      if (choice.choice === 'deny' || choice.choice === 'cancel') { this.retire(requestId, '用户拒绝'); return { state: 'retired' }; }
      if(record.payload.phase!=='waiting_user')throw new DriverError('REJECTED','此授权已批准待绑定，只能撤销');
      const allowed = record.payload.options?.map(o => o.value) ?? ['allow'];
      if (!allowed.includes(choice.choice)) throw new DriverError('REJECTED', '不是此请求公布的批准选项');
      this.current(record); const handler = this.handlers.get(record.payload.businessKind); if (!handler) throw new DriverError('UNSUPPORTED', '此业务尚不能执行');
      const run = this.d.run(taskId);try{await handler.validate(record, choice, run);this.current(record);}catch(e){this.retire(requestId,'批准前核对失败：'+(e as Error).message);throw e;}
      if (handler.needsRun && !run) {
        if (this.d.hasOwner(taskId)) throw new DriverError('STATE', '原运行尚未退出，授权暂不能绑定；请稍后重试');
        return this.pendingBind(record, choice);
      }
      if(choice.choice==='edit'){if(!sender||!handler.revise)throw new DriverError('UNSUPPORTED','此业务不能手动修改');const revised=await handler.revise(record,choice,sender);this.current(record);this.d.store.tx(emit=>{const changed=this.d.store.sqlite.prepare('UPDATE agent_requests SET review_hash=?,account_identity=?,payload_ref=?,revision=revision+1,updated_at=? WHERE request_id=? AND revision=?').run(sha256(JSON.stringify(revised.review)),revised.accountIdentity??null,JSON.stringify({...record.payload,review:revised.review,data:revised.data}),now(),requestId,revision);if(changed.changes!==1)throw new Error('请求已变化');emit(taskId,'request.changed',{requestId});});return{state:'waiting_user',revision:revision+1};}
      return await this.execute(record, handler, choice, run,sender);
    } finally { this.deciding.delete(requestId); }
  }
  /** Runs after actual PID/birth registration and before dispatching any input. */
  async bindPending(taskId: string, run: RunHandle) {
    const rows = this.d.store.sqlite.prepare("SELECT request_id FROM agent_requests WHERE task_id=? AND class='host_business' AND status='approved_pending_bind' ORDER BY created_at,rowid").all(taskId) as { request_id: string }[];
    for (const r of rows) {
      if (this.deciding.has(r.request_id)) continue; this.deciding.add(r.request_id);
      try {
        const record = this.record(r.request_id), handler = this.handlers.get(record.payload.businessKind);
        if (!handler?.needsRun) throw new Error('授权绑定处理器不可用');
        this.current(record); await handler.validate(record, record.payload.decision, run); this.current(record);
        if (this.d.run(taskId)?.runId !== run.runId) throw new Error('新运行身份已经变化');
        await this.execute(record, handler, record.payload.decision, run);
      } catch (e) { this.retire(r.request_id, `授权未绑定：${(e as Error).message}`); }
      finally { this.deciding.delete(r.request_id); }
    }
  }
  async present(taskId:string,id:string,revision:number,sender:ApplicationUiSender){const r=this.record(id);if(r.row.task_id!==taskId||r.row.revision!==revision||r.row.status!=='pending')throw new DriverError('REJECTED','请求已更新');this.current(r);return this.handlers.get(r.payload.businessKind)?.present?.(r,sender)??{reviewHash:r.row.review_hash,requestId:r.row.request_id};}
  private update(record: BusinessRecord, status: string, payload: BusinessPayload, run?: RunHandle) {
    this.d.store.tx(emit => {
      const result = this.d.store.sqlite.prepare('UPDATE agent_requests SET status=?,payload_ref=?,bound_run_id=COALESCE(?,bound_run_id),revision=revision+1,updated_at=? WHERE request_id=? AND revision=? AND status=?').run(status, JSON.stringify(payload), run?.runId ?? null, now(), record.row.request_id, record.row.revision, record.row.status);
      if (result.changes !== 1) throw new DriverError('REJECTED', '业务请求发生并发变化');
      emit(record.row.task_id, 'request.changed', { requestId: record.row.request_id, status });
    });
  }
  private pendingBind(record: BusinessRecord, decision: unknown) {
    if (record.payload.phase !== 'approved_pending_bind') this.update(record, 'approved_pending_bind', { ...record.payload, decision, phase: 'approved_pending_bind' });
    this.d.notify(record.row.task_id, `business-bind-${record.row.request_id}`, '宿主：浏览器请求已批准，待新运行登记和重新校验后绑定；绑定前尚无可用权限，操作尚未执行。这是状态通知，不是新的真人授权。', true);
    return { state: 'approved_pending_bind' };
  }
  private execute(record:BusinessRecord,handler:BusinessHandler,decision:unknown,run?:RunHandle,sender?:ApplicationUiSender){const work=this.executeOwned(record,handler,decision,run,sender);this.inflight.add(work);void work.finally(()=>this.inflight.delete(work)).catch(()=>{});return work;}
  private async executeOwned(record: BusinessRecord, handler: BusinessHandler, decision: unknown, run?: RunHandle,sender?:ApplicationUiSender) {
    const id = record.row.request_id, taskId = record.row.task_id, controller = new AbortController(); this.executing.set(id, controller);
    let release: (() => void) | undefined;const budget=this.d.executionMs??60000,deadline=Date.now()+budget,timeout=AbortSignal.timeout(budget),signal=AbortSignal.any([controller.signal,timeout]);
    try {
      release = await this.d.acquire?.(taskId, record.row.operation_id, signal);
      this.current(record);
      // Approval may wait in the directory FIFO. Never attach it to the owner captured before that wait.
      if (handler.needsRun) {
        run = this.d.run(taskId);
        if (!run) {
          if (this.d.hasOwner(taskId)) throw new DriverError('STATE', '原运行尚未退出，不能绑定业务请求');
          return this.pendingBind(record, decision);
        }
      }
      await handler.validate(record, decision, run); this.current(record);
      if(signal.aborted)throw new DriverError('REJECTED','批准后的本次执行时限已结束，请重新核对后批准');const started=now();
      this.update(record, 'pending', { ...record.payload, phase: 'executing', decision, executionStartedAt: started }, run);
      const running = this.record(id);
      let result: unknown, error: string | undefined;
      try { result = await handler.execute(running, decision, { signal, deadline, run,sender }); }
      catch (e) { error = (e as Error).message; }
      // Keep the business lease until the actual executor settles, even when it ignores cancellation.
      const fresh = this.record(id);
      const failure=result&&typeof result==='object'&&(result as {status?:string}).status==='error'?(result as {error?:{effectState?:string;message?:string}}).error:undefined;const terminal = signal.aborted || error || failure?.effectState==='unknown' ? 'unknown' : failure?'failed':'finished';
      this.d.store.tx(emit => {
        const itemId = this.d.store.addHostItem(taskId, null, 'notification', { sourceKind: 'system', title: record.payload.title, status: terminal, operationId: record.row.operation_id, requestId: id, result: result ?? null, ...(error ? { error } : {}) });
        this.d.store.sqlite.prepare("UPDATE agent_requests SET status=CASE WHEN status='retired' THEN status ELSE 'resolved' END,payload_ref=?,decision_ref=?,revision=revision+1,updated_at=? WHERE request_id=?").run(JSON.stringify({ ...fresh.payload, phase: terminal, resultItemId: itemId }), JSON.stringify(decision), now(), id);
        emit(taskId, 'request.resolved', { requestId: id });
        this.d.notify(taskId, `business-result-${id}`, `宿主业务结果通知：${record.payload.title}，${terminal}。详情引用 ${itemId}；这不是新的真人授权。`, !this.stopped(taskId));
      });
      return { state: terminal, requestId: id };
    } catch (e) {
      // No effect was launched. Retire this approval, rather than leaving an invisible FIFO retry behind.
      if (!this.closed) this.retire(id, '本次业务未执行：' + (e as Error).message);
      throw e;
    } finally { release?.(); this.executing.delete(id); }
  }
  retire(id: string, reason: string, wake=true) {
    const record = this.record(id); this.executing.get(id)?.abort(new Error(reason));
    if (!['pending','approved_pending_bind'].includes(record.row.status)) return;
    this.d.store.tx(emit => { this.d.store.sqlite.prepare("UPDATE agent_requests SET status='retired',revision=revision+1,updated_at=? WHERE request_id=? AND status IN ('pending','approved_pending_bind')").run(now(), id); emit(record.row.task_id, 'request.retired', { requestId: id, reason }); });
    try{const cleanup=this.handlers.get(record.payload.businessKind)?.retire?.(record);if(cleanup){this.inflight.add(cleanup);void cleanup.catch(e=>{if(!this.closed)this.d.store.addHostItem(record.row.task_id,null,'system_notice',{code:'businessRetirementPending',detail:'请求已退役；原业务清理仍需核对：'+String((e as Error).message)});}).finally(()=>this.inflight.delete(cleanup));}}catch(e){this.d.store.addHostItem(record.row.task_id,null,'system_notice',{code:'businessRetirementPending',detail:'请求已退役；原业务清理仍需核对：'+String((e as Error).message)});}
    this.d.store.addHostItem(record.row.task_id, null, 'system_notice', { code: 'businessRequestRetired', detail: reason });
    this.d.notify(record.row.task_id,`business-retired-${id}`,`宿主业务请求已退役：${record.payload.title}。${reason}。未批准的操作不会执行；这是状态通知，不是新的真人授权。`,wake&&!this.stopped(record.row.task_id));
  }
  stop(taskId: string) { for(const h of this.handlers.values())h.stop?.(taskId);for (const r of this.d.store.pendingRequests(taskId)) if (r.class === 'host_business') this.retire(r.requestId, '任务已停止，业务请求及待绑定授权已撤销',false); }
  busy(taskId: string) { return this.d.store.pendingRequests(taskId).some(r => r.class === 'host_business') || [...this.executing.keys()].some(id => this.d.store.request(id)?.task_id === taskId); }
  async reconcile(){if(this.closed||this.reconciling)return;this.reconciling=true;try{for(const row of this.d.store.sqlite.prepare("SELECT request_id FROM agent_requests WHERE class='host_business' AND status IN ('pending','approved_pending_bind')").all() as {request_id:string}[]){if(this.deciding.has(row.request_id)||this.executing.has(row.request_id))continue;const r=this.record(row.request_id);try{this.current(r);const h=this.handlers.get(r.payload.businessKind);if(!h)continue;await h.validate(r,r.payload.decision??{choice:r.payload.options?.[0]?.value??'allow'},this.d.run(r.row.task_id));}catch(e){this.retire(row.request_id,'业务请求已失效：'+(e as Error).message);}}}finally{this.reconciling=false;}}
  async close() { this.closed = true; for (const c of this.executing.values()) c.abort(new Error('宿主关闭'));await Promise.allSettled([...this.inflight]); /* waiting records survive restart */ }
}
