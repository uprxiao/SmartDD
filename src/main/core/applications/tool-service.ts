import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import type { JsonSchemaType } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ApplicationError, type ApplicationManifest, type InstalledApplicationPackage } from '@shared/applications';
import { BRIDGE_LIMITS, boundedJson, bridgeCallSchema, type BridgeToolCall, type BridgeFailure, type BridgeResponse, type BridgeTool } from '@shared/application-bridge';
import { canonicalJson, digest } from './manifest';
import { verifyPackageTree } from './package-files';
import { PackageRegistry } from './package-registry';
import type { ResourceStore } from './resource-store';
import { withResourceLock } from './resource-lock';
import type { CapabilityRunRegistry, RunContext } from './run-registry';
export interface ApplicationOperationContext { operationId: string;requestId: string;attempt: number;deadline: number;signal: AbortSignal;packageHash: string;appId: string;toolName: string;contractMajor: number;connectionId: string | null }
export interface HostToolOperation {
  semantics: 'read' | 'write';
  /** Only a trusted read executor may request transport retries; annotations alone never authorize them. */
  retry: 'safe-read' | 'never';timeoutMs?: number;
  authorize(context: RunContext,connectionId: string | null): void;
  execute(context: RunContext,args: Record<string,unknown>,operation: ApplicationOperationContext): Promise<unknown>;
}
export interface ApplicationToolHost {
  resolve(packageHash: string,toolName: string,contractMajor: number): HostToolOperation;
}
interface InvocationRow { operation_id: string;request_hash: string;state: 'running' | 'succeeded' | 'failed' | 'unknown';attempt_count: number;effect_state: BridgeFailure['effectState'];error_code: string | null }
interface SelectedTool { application: InstalledApplicationPackage;declaration: ApplicationManifest['tools'][number];tool: BridgeTool }
const failure = (error: unknown,attempts = 0,effect: BridgeFailure['effectState'] = 'not-started',exhausted = false): BridgeFailure => {
  const code = error instanceof ApplicationError ? error.code : 'CAPABILITY_UNAVAILABLE';
  return { code,message: error instanceof ApplicationError ? error.message : '应用能力本次调用未完成',layer: ['SCOPE_DENIED','AUTH_REQUIRED','AUTH_FAILED','AUTHORIZATION_REQUIRED'].includes(code) ? 'auth' : ['CONFIG_INCOMPATIBLE','HOST_INCOMPATIBLE','INVALID_INPUT','INVALID_PACKAGE','TOO_LARGE'].includes(code) ? 'config' : 'provider',retryable: effect !== 'unknown' && ['TRANSIENT_FAILURE','TIMEOUT'].includes(code),attemptCount: attempts,retryExhausted: exhausted,effectState: effect,nextAction: effect === 'unknown' ? '查看已有业务执行记录并核实结果，不要自动重发' : '核对本次错误后重新明确操作' };
};
/** Fixed package contracts + run-derived context. No model argument ever selects project or package. */
export class ApplicationToolService {
  private readonly packages: PackageRegistry;
  private readonly validator = new AjvJsonSchemaValidator();
  private readonly pending = new Map<string,{ hash: string;work: Promise<BridgeResponse> }>();
  private readonly cache = new Map<string,{ hash: string;response: BridgeResponse;bytes: number }>();
  private cacheBytes = 0;
  constructor(readonly store: ResourceStore,private readonly runs: CapabilityRunRegistry,private readonly host: ApplicationToolHost,private readonly options: { retryDelays?: readonly number[];now?: () => number } = {}) { this.packages = new PackageRegistry(store,'tool-reader'); }
  private clock(): number { return this.options.now?.() ?? Date.now(); }
  private schema(source: string): { type: 'object';[key: string]: unknown } {
    const raw = Buffer.from(source,'utf8');
    if (raw.length > BRIDGE_LIMITS.requestBytes) throw new ApplicationError('TOO_LARGE','工具契约超过本次预算');
    const json: unknown = JSON.parse(raw.toString('utf8'));
    if (!boundedJson(json) || !json || Array.isArray(json) || typeof json !== 'object' || (json as { type?: unknown }).type !== 'object') throw new ApplicationError('INVALID_PACKAGE','工具契约必须是有界JSON对象schema');
    return json as { type: 'object';[key: string]: unknown };
  }
  private selected(context: RunContext,call: Pick<BridgeToolCall,'operation' | 'contractMajor'>,verifyBytes = true): SelectedTool {
    const selected = context.snapshot.packages.find(p => Object.hasOwn(p.toolContractMajors,call.operation));
    if (!selected || selected.toolContractMajors[call.operation] !== call.contractMajor) throw new ApplicationError('SCOPE_DENIED','此原会话未选用该工具契约');
    const application = this.packages.get(selected.packageHash), declaration = application.manifest.tools.find(t => t.name === call.operation && t.contractMajor === call.contractMajor);
    if (application.appId !== selected.appId || !declaration || !selected.allowedOperations.includes(declaration.permission)) throw new ApplicationError('SCOPE_DENIED','工具不在此原会话允许的动作范围');
    const resource = this.store.get(application.resourceId); if (verifyBytes && (resource.state !== 'ready' || resource.integrity !== 'valid')) throw new ApplicationError('CAPABILITY_UNAVAILABLE','固定应用包尚不可用');
    if (verifyBytes) verifyPackageTree(join(this.store.root,application.relativePath),application,this.store.storeId);
    const schemas = this.packages.toolContractSources(application.packageHash,declaration.name);
    return { application,declaration,tool: { name: declaration.name,description: application.manifest.description,inputSchema: this.schema(schemas.input),outputSchema: this.schema(schemas.output),annotations: declaration.annotations,contractMajor: declaration.contractMajor } };
  }
  async list(runId: string): Promise<{ tools: BridgeTool[];unavailable: { appId: string;code: string }[] }> {
    return this.runs.withActivity(runId,async context => {
      const tools: BridgeTool[] = [], unavailable: { appId: string;code: string }[] = [];
      for (const application of context.snapshot.packages) {
        const group: BridgeTool[] = [];
        try {
          const manifest = this.packages.get(application.packageHash).manifest;
          const permitted = Object.entries(application.toolContractMajors).filter(([name]) => application.allowedOperations.includes(manifest.tools.find(t => t.name === name)!.permission));
          for (const [operation,contractMajor] of permitted) group.push(this.selected(context,{ operation,contractMajor },false).tool);
          tools.push(...group);
          if (permitted.length) { const [operation,contractMajor] = permitted[0]; this.selected(context,{ operation,contractMajor }); }
        }
        catch (error) { unavailable.push({ appId: application.appId,code: error instanceof ApplicationError ? error.code : 'CAPABILITY_UNAVAILABLE' }); }
      }
      this.runs.assertActive(runId); return { tools,unavailable };
    });
  }
  call(runId: string,requestId: string,input: BridgeToolCall,signal?: AbortSignal): Promise<BridgeResponse> {
    try {
      this.runs.assertActive(runId);
      if (!z.uuid().safeParse(requestId).success || !boundedJson(input) || Buffer.byteLength(JSON.stringify(input)) > BRIDGE_LIMITS.requestBytes) throw new ApplicationError('INVALID_INPUT','调用编号或JSON范围无效');
      const parsed = bridgeCallSchema.safeParse(input); if (!parsed.success) throw new ApplicationError('INVALID_INPUT','工具调用包含未允许字段或契约无效');
      const call = parsed.data, context = this.runs.assertActive(runId), selected = this.selected(context,call);
      const handler = this.host.resolve(selected.application.packageHash,call.operation,call.contractMajor); handler.authorize(context,call.connectionId);
      const hash = digest(canonicalJson(call)), key = runId + ':' + requestId, previous = this.pending.get(key) ?? this.cache.get(key);
      if (previous) { if (previous.hash !== hash) throw new ApplicationError('REQUEST_CONFLICT','同一调用编号已经用于其他输入'); return 'work' in previous ? previous.work : Promise.resolve(previous.response); }
      const budget = Math.min(120000,Math.max(1,handler.timeoutMs ?? (handler.semantics === 'read' ? 30000 : 60000))), timeout = AbortSignal.timeout(budget), operationSignal = AbortSignal.any([context.signal,timeout,...(signal ? [signal] : [])]), deadline = this.clock() + budget;
      let onAbort!: () => void;
      const interrupted = new Promise<BridgeResponse>(resolve => { onAbort = () => { const row = this.store.sqlite.prepare('SELECT operation_id,effect_state,attempt_count FROM application_invocations WHERE run_id=? AND request_id=?').get(runId,requestId) as InvocationRow | undefined; resolve({ schema: 1,id: requestId,status: 'error',error: failure(new ApplicationError(timeout.aborted ? 'TIMEOUT' : 'CANCELED','本次等待已结束，执行者尚未返回时须核对已有业务记录'),row?.attempt_count ?? 0,row?.effect_state ?? 'not-started'),...(row ? { operationId: row.operation_id } : {}) }); }; operationSignal.addEventListener('abort',onAbort,{ once: true }); if (operationSignal.aborted) onAbort(); });
      const execution = Promise.resolve().then(() => this.execute(runId,requestId,call,hash,{ signal: operationSignal,deadline,timeout }));
      const work = Promise.race([execution,interrupted]).finally(() => operationSignal.removeEventListener('abort',onAbort)); this.pending.set(key,{ hash,work });
      void work.then(response => { const bytes = Buffer.byteLength(JSON.stringify(response)); this.cache.set(key,{ hash,response,bytes }); this.cacheBytes += bytes; while (this.cache.size > 256 || this.cacheBytes > 16 * 1024 * 1024) { const first = this.cache.keys().next().value!; this.cacheBytes -= this.cache.get(first)!.bytes; this.cache.delete(first); } },() => undefined).finally(() => this.pending.delete(key));
      return work;
    } catch (error) { return Promise.resolve({ schema: 1,id: requestId,status: 'error',error: failure(error) }); }
  }
  private async execute(runId: string,requestId: string,call: BridgeToolCall,hash: string,control: { signal: AbortSignal;deadline: number;timeout: AbortSignal }): Promise<BridgeResponse> {
    let operationId: string | undefined, attempts = 0, effect: BridgeFailure['effectState'] = 'not-started', exhausted = false;
    try {
      if (control.signal.aborted) throw new ApplicationError(control.timeout.aborted ? 'TIMEOUT' : 'CANCELED','本次调用已取消');
      return await this.runs.withActivity(runId,async context => {
        const selected = this.selected(context,call), handler = this.host.resolve(selected.application.packageHash,call.operation,call.contractMajor);
        if (handler.semantics === 'write' && (handler.retry !== 'never' || selected.declaration.annotations.readOnlyHint)) throw new ApplicationError('HOST_INCOMPATIBLE','写操作不能使用通用自动重试');
        if (handler.semantics === 'read' && !selected.declaration.annotations.readOnlyHint) throw new ApplicationError('HOST_INCOMPATIBLE','宿主执行语义与固定工具契约不同');
        handler.authorize(context,call.connectionId);
        if (!this.validator.getValidator(selected.tool.inputSchema as JsonSchemaType)(call.arguments).valid) throw new ApplicationError('INVALID_INPUT','参数不符合原工具输入契约');
        const recorded = await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
          this.runs.assertActive(runId); handler.authorize(context,call.connectionId);
          const old = this.store.sqlite.prepare('SELECT * FROM application_invocations WHERE run_id=? AND request_id=?').get(runId,requestId) as InvocationRow | undefined;
          if (old) { if (old.request_hash !== hash) throw new ApplicationError('REQUEST_CONFLICT','同一调用编号内容已改变'); return old; }
          operationId = randomUUID();
          this.store.sqlite.prepare("INSERT INTO application_invocations(operation_id,run_id,request_id,request_hash,project_id,task_id,app_id,package_hash,tool_name,contract_major,connection_id,semantics,state,effect_state,started_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'running','not-started',?)").run(operationId,runId,requestId,hash,context.run.projectId,context.run.taskId,selected.application.appId,selected.application.packageHash,call.operation,call.contractMajor,call.connectionId,handler.semantics,new Date(this.clock()).toISOString()); return null;
        }).immediate());
        if (recorded) { operationId = recorded.operation_id; attempts = recorded.attempt_count; effect = recorded.effect_state; throw new ApplicationError('REPLAY_UNAVAILABLE','已有执行账，原回执不在本次内存中；请查看业务记录，不重新执行'); }
        const { signal,deadline,timeout } = control;
        const outputValidator = this.validator.getValidator(selected.tool.outputSchema as JsonSchemaType), canRetry = handler.semantics === 'read' && handler.retry === 'safe-read';
        while (true) {
          if (signal.aborted) throw new ApplicationError(timeout.aborted ? 'TIMEOUT' : 'CANCELED','调用已取消或到达本次时限');
          const fresh = this.runs.assertActive(runId); handler.authorize(fresh,call.connectionId); attempts++;
          effect = handler.semantics === 'read' ? 'read-only' : 'unknown';
          await withResourceLock(this.store.root,() => { this.store.sqlite.prepare('UPDATE application_invocations SET attempt_count=?,effect_state=? WHERE operation_id=?').run(attempts,effect,operationId); });
          if (signal.aborted) throw new ApplicationError(timeout.aborted ? 'TIMEOUT' : 'CANCELED','执行前调用已取消');
          this.runs.assertActive(runId); handler.authorize(this.runs.assertActive(runId),call.connectionId);
          // An executor may ignore cancellation; its activity lease stays held until it really settles.
          try {
            const value = await handler.execute(fresh,call.arguments,{ operationId: operationId!,requestId,attempt: attempts,deadline,signal,packageHash: selected.application.packageHash,appId: selected.application.appId,toolName: call.operation,contractMajor: call.contractMajor,connectionId: call.connectionId });
            if (!boundedJson(value) || Buffer.byteLength(JSON.stringify(value)) > BRIDGE_LIMITS.responseBytes - 4096) throw new ApplicationError('TOO_LARGE','响应超过本次预算，请使用分页或有界资源');
            if (!outputValidator(value).valid) throw new ApplicationError('INVALID_RESPONSE','结果不符合固定工具输出契约');
            this.runs.assertActive(runId); handler.authorize(this.runs.assertActive(runId),call.connectionId);
            if (signal.aborted) throw new ApplicationError(timeout.aborted ? 'TIMEOUT' : 'CANCELED','本次等待已结束，请查看已有业务执行记录');
            effect = handler.semantics === 'read' ? 'read-only' : 'completed'; await this.end(operationId!,'succeeded',attempts,effect,null);
            return { schema: 1 as const,id: requestId,status: 'ok' as const,value,operationId,effectState: effect };
          } catch (error) {
            const retryable = error instanceof ApplicationError && ['TRANSIENT_FAILURE','TIMEOUT'].includes(error.code);
            if (!canRetry || !retryable || signal.aborted) throw error;
            if (attempts >= 3) { exhausted = true; throw error; }
            const wait = Math.min(5000,Math.max(0,this.options.retryDelays?.[attempts - 1] ?? ([1000,3000][attempts - 1] + Math.floor(Math.random() * 100))));
            if (this.clock() + wait >= deadline) { exhausted = true; throw error; }
            try { await delay(wait,undefined,{ signal }); } catch { throw new ApplicationError(timeout.aborted ? 'TIMEOUT' : 'CANCELED','重试等待已取消'); }
          }
        }
      });
    } catch (error) {
      if (operationId && !(error instanceof ApplicationError && error.code === 'REPLAY_UNAVAILABLE')) await this.end(operationId,(effect as BridgeFailure['effectState']) === 'unknown' ? 'unknown' : 'failed',attempts,effect,error instanceof ApplicationError ? error.code : 'CAPABILITY_UNAVAILABLE');
      return { schema: 1,id: requestId,status: 'error',error: failure(error,attempts,effect,exhausted),...(operationId ? { operationId } : {}) };
    }
  }
  private async end(id: string,state: 'succeeded' | 'failed' | 'unknown',attempts: number,effect: BridgeFailure['effectState'],code: string | null): Promise<void> {
    await withResourceLock(this.store.root,() => { this.store.sqlite.prepare('UPDATE application_invocations SET state=?,attempt_count=?,effect_state=?,error_code=?,ended_at=? WHERE operation_id=?').run(state,attempts,effect,code,new Date(this.clock()).toISOString(),id); });
  }
  clearMemory(runId: string): void { for (const [key,item] of this.cache) if (key.startsWith(runId + ':')) { this.cache.delete(key); this.cacheBytes -= item.bytes; } }
}
