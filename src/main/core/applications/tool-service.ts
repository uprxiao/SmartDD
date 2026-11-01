import {applicationInvocationDeclarations,type ApplicationEntry} from '@shared/application-capabilities';
import {cliInvocationCallSchema} from '@shared/application-cli';
import {assertRunApplication} from './application-run-scope';
import {applicationConnectionNotice} from './application-run-policy';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';
import type { JsonSchemaType } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ApplicationError, type ApplicationManifest, type InstalledApplicationPackage } from '@shared/applications';
import {retryAfterWait} from './retry-after';
import { BRIDGE_LIMITS, boundedJson, bridgeCallSchema, type BridgeToolCall, type BridgeFailure, type BridgeResponse, type BridgeTool } from '@shared/application-bridge';
import { canonicalJson, digest } from './manifest';
import { verifyPackageTree } from './package-files';
import { PackageRegistry } from './package-registry';
import type { ResourceStore } from './resource-store';
import { withResourceLock } from './resource-lock';
import type { CapabilityRunRegistry, RunContext } from './run-registry';
import {requirePlanEntry} from './run-plan';
/** AbortSignal.any retains the first reason; a later deadline cannot replace an earlier caller cancellation. */
const interruptionCode=(signal:AbortSignal,timeout:AbortSignal):'TIMEOUT'|'CANCELED'=>timeout.aborted&&signal.reason===timeout.reason?'TIMEOUT':'CANCELED';
export interface ApplicationOperationContext { operationId: string;requestId: string;attempt: number;deadline: number;signal: AbortSignal;packageHash: string;appId: string;toolName: string;contractMajor: number;connectionId: string | null;entry?:ApplicationEntry }
export interface HostToolOperation {
  semantics: 'read' | 'write';
  /** Only a trusted read executor may request transient transport/source retries; annotations alone never authorize them. */
  retry: 'safe-read' | 'never';timeoutMs?: number;
  authorize(context: RunContext,connectionId: string | null): void;
  /** Revalidate the original operation target before returning a cached receipt. */
  authorizeReceipt?(context: RunContext,operationId: string,connectionId: string | null,signal?:AbortSignal): void|Promise<void>;
  execute(context: RunContext,args: Record<string,unknown>,operation: ApplicationOperationContext): Promise<unknown>;
}
export interface ApplicationToolHost {
  resolve(packageHash: string,toolName: string,contractMajor: number,entry?:ApplicationEntry): HostToolOperation;
}
interface InvocationRow { operation_id: string;request_hash: string;state: 'running' | 'succeeded' | 'failed' | 'unknown';attempt_count: number;effect_state: BridgeFailure['effectState'];error_code: string | null }
interface SelectedTool { application: InstalledApplicationPackage;declaration: ApplicationManifest['tools'][number];tool: BridgeTool }
const failure = (error: unknown,attempts = 0,effect: BridgeFailure['effectState'] = 'not-started',exhausted = false): BridgeFailure => {
  const code = error instanceof ApplicationError ? error.code : 'CAPABILITY_UNAVAILABLE';
  if(code==='UPSTREAM_RESULT_UNKNOWN')effect='unknown';
  return { code,message: error instanceof ApplicationError ? error.message : '应用能力本次调用未完成',layer: ['SCOPE_DENIED','ENTRY_NOT_ACTIVE','SENDER_IDENTITY_REQUIRED','SENDER_IDENTITY_MISMATCH','AUTH_REQUIRED','AUTH_FAILED','AUTHORIZATION_REQUIRED'].includes(code) ? 'auth' : ['CONFIG_INCOMPATIBLE','HOST_INCOMPATIBLE','INVALID_INPUT','INVALID_PACKAGE','TOO_LARGE'].includes(code) ? 'config' : 'provider',retryable: effect !== 'unknown' && (['TRANSIENT_FAILURE','TIMEOUT'].includes(code) || (code === 'RESOURCE_BUSY' && effect === 'read-only')),attemptCount: attempts,retryExhausted: exhausted,effectState: effect,nextAction: effect === 'unknown' ? '查看已有业务执行记录并核实结果，不要自动重发' : exhausted ? '本次重试已结束，请稍后明确重试' : '核对本次错误后重新明确操作' };
};
/** Fixed package contracts + run-derived context. No model argument ever selects project or package. */
export class ApplicationToolService {
  private readonly packages: PackageRegistry;
  private readonly validator = new AjvJsonSchemaValidator();
  private readonly pending = new Map<string,{ hash: string;work: Promise<BridgeResponse> }>();
  private readonly cache = new Map<string,{ hash: string;response: BridgeResponse;bytes: number }>();
  private cacheBytes = 0;
  constructor(readonly store: ResourceStore,private readonly runs: CapabilityRunRegistry,private readonly host: ApplicationToolHost,private readonly options: { retryDelays?: readonly number[];now?: () => number;entry?:ApplicationEntry } = {}) { this.packages = new PackageRegistry(store,'tool-reader'); }
  private get entry():ApplicationEntry{return this.options.entry??'mcp';}
  get invocationEntry():ApplicationEntry{return this.entry;}
  private handler(hash:string,operation:string,major:number){return this.entry==='cli'?this.host.resolve(hash,operation,major,'cli'):this.host.resolve(hash,operation,major);}
  private snapshotContracts(context:RunContext){
    if(this.entry==='cli')return context.snapshot.schema===3?context.snapshot.packages.map(selection=>({selection,contracts:selection.capabilityContractMajors})):[];
    return context.snapshot.packages.map(selection=>({selection,contracts:selection.toolContractMajors}));
  }
  private clock(): number { return this.options.now?.() ?? Date.now(); }
  private schema(source: string): { type: 'object';[key: string]: unknown } {
    const raw = Buffer.from(source,'utf8');
    if (raw.length > BRIDGE_LIMITS.requestBytes) throw new ApplicationError('TOO_LARGE','工具契约超过本次预算');
    const json: unknown = JSON.parse(raw.toString('utf8'));
    if (!boundedJson(json) || !json || Array.isArray(json) || typeof json !== 'object' || (json as { type?: unknown }).type !== 'object') throw new ApplicationError('INVALID_PACKAGE','工具契约必须是有界JSON对象schema');
    return json as { type: 'object';[key: string]: unknown };
  }
  private selected(context: RunContext,call: Pick<BridgeToolCall,'operation' | 'contractMajor'>,verifyBytes = true): SelectedTool {
    const record=this.snapshotContracts(context).find(p=>Object.hasOwn(p.contracts,call.operation)),selected=record?.selection;
    if (!selected || record?.contracts[call.operation] !== call.contractMajor) throw new ApplicationError('SCOPE_DENIED','此原会话未选用该能力契约');
    assertRunApplication(context,selected.appId);
    if(context.plan){const allowed=context.plan.allowed.find(c=>(this.entry==='cli'?c.capabilityId:c.mcpTool)===call.operation&&c.contractMajor===call.contractMajor&&c.packageHash===selected.packageHash);if(!allowed)throw new ApplicationError('SCOPE_DENIED','能力不在本次运行允许表中');requirePlanEntry(context.plan,allowed.capabilityId,call.contractMajor,this.entry);}
    else if(this.entry==='cli')throw new ApplicationError('SCOPE_DENIED','CLI调用必须有固定运行计划');
    const application = this.packages.get(selected.packageHash), declaration = applicationInvocationDeclarations(application.manifest,this.entry).find(t => t.name === call.operation && t.contractMajor === call.contractMajor);
    if (application.appId !== selected.appId || !declaration || !selected.allowedOperations.includes(declaration.permission)) throw new ApplicationError('SCOPE_DENIED','工具不在此原会话允许的动作范围');
    const resource = this.store.get(application.resourceId); if (verifyBytes && (resource.state !== 'ready' || resource.integrity !== 'valid')) throw new ApplicationError('CAPABILITY_UNAVAILABLE','固定应用包尚不可用');
    if (verifyBytes) verifyPackageTree(join(this.store.root,application.relativePath),application,this.store.storeId);
    const schemas = this.packages.toolContractSources(application.packageHash,declaration.name);
    const inputSchema = this.schema(schemas.input);
    const originalDescription = typeof inputSchema.description === 'string' && inputSchema.description.length <= 2000 ? inputSchema.description : application.manifest.description,notice=applicationConnectionNotice(this.store,context.snapshot,application.appId);
    const description=notice?originalDescription+'\n\n'+notice:originalDescription;
    return { application,declaration,tool: { name: declaration.name,description,inputSchema,outputSchema: this.schema(schemas.output),annotations: declaration.annotations,contractMajor: declaration.contractMajor } };
  }
  async list(runId: string): Promise<{ tools: BridgeTool[];unavailable: { appId: string;code: string }[] }> {
    return this.runs.withActivity(runId,async context => {
      const tools: BridgeTool[] = [], unavailable: { appId: string;code: string }[] = [];
      for (const {selection:application,contracts} of this.snapshotContracts(context)) {
        const group: BridgeTool[] = [];
        try {
          assertRunApplication(context,application.appId);
          const manifest = this.packages.get(application.packageHash).manifest;
          const permitted = Object.entries(contracts).filter(([name,major]) => {const declaration=applicationInvocationDeclarations(manifest,this.entry).find(t=>t.name===name);return !!declaration&&application.allowedOperations.includes(declaration.permission)&&(!context.plan&&this.entry==='mcp'||!!context.plan?.allowed.some(c=>(this.entry==='cli'?c.capabilityId:c.mcpTool)===name&&c.contractMajor===major&&c.packageHash===application.packageHash&&c.entry===this.entry));});
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
      const parsed = (this.entry==='cli'?cliInvocationCallSchema:bridgeCallSchema).safeParse(input); if (!parsed.success) throw new ApplicationError('INVALID_INPUT','能力调用包含未允许字段或契约无效');
      const call = parsed.data, context = this.runs.assertActive(runId), selected = this.selected(context,call);
      const handler = this.handler(selected.application.packageHash,call.operation,call.contractMajor);
      const hash = digest(canonicalJson(call)), key = runId + ':' + requestId, previous = this.pending.get(key) ?? this.cache.get(key);
      if (previous) {
        if (previous.hash !== hash) throw new ApplicationError('REQUEST_CONFLICT','同一调用编号已经用于其他输入');
        return ('work' in previous ? previous.work : Promise.resolve(previous.response)).then(response=>this.receipt(runId,requestId,call,handler,response,signal));
      }
      handler.authorize(context,call.connectionId);
      const budget = Math.min(120000,Math.max(1,handler.timeoutMs ?? (handler.semantics === 'read' ? 30000 : 60000))), timeout = AbortSignal.timeout(budget), operationSignal = AbortSignal.any([context.signal,timeout,...(signal ? [signal] : [])]), deadline = this.clock() + budget;
      let onAbort!: () => void;
      const interrupted = new Promise<BridgeResponse>(resolve => { onAbort = () => { const row = this.store.sqlite.prepare('SELECT operation_id,effect_state,attempt_count FROM application_invocations WHERE run_id=? AND request_id=?').get(runId,requestId) as InvocationRow | undefined; resolve({ schema: 1,id: requestId,status: 'error',error: failure(new ApplicationError(interruptionCode(operationSignal,timeout),'本次等待已结束，执行者尚未返回时须核对已有业务记录'),row?.attempt_count ?? 0,row?.effect_state ?? 'not-started'),...(row ? { operationId: row.operation_id } : {}) }); }; operationSignal.addEventListener('abort',onAbort,{ once: true }); if (operationSignal.aborted) onAbort(); });
      const execution = Promise.resolve().then(() => this.execute(runId,requestId,call,hash,{ signal: operationSignal,deadline,timeout }));
      const work = Promise.race([execution,interrupted]).finally(() => operationSignal.removeEventListener('abort',onAbort)); this.pending.set(key,{ hash,work });
      void work.then(response => { const bytes = Buffer.byteLength(JSON.stringify(response)); this.cache.set(key,{ hash,response,bytes }); this.cacheBytes += bytes; while (this.cache.size > 256 || this.cacheBytes > 16 * 1024 * 1024) { const first = this.cache.keys().next().value!; this.cacheBytes -= this.cache.get(first)!.bytes; this.cache.delete(first); } },() => undefined).finally(() => this.pending.delete(key));
      return work;
    } catch (error) { return Promise.resolve({ schema: 1,id: requestId,status: 'error',error: failure(error) }); }
  }
  private receipt(runId:string,requestId:string,call:BridgeToolCall,handler:HostToolOperation,response:BridgeResponse,callerSignal?:AbortSignal):Promise<BridgeResponse>{
    const recorded=response.operationId?this.store.sqlite.prepare('SELECT attempt_count FROM application_invocations WHERE operation_id=? AND run_id=?').get(response.operationId,runId) as {attempt_count:number}|undefined:undefined;
    const effect=response.status==='error'?response.error.effectState:response.effectState??(handler.semantics==='read'?'read-only':'unknown'),attempts=response.status==='error'?response.error.attemptCount:recorded?.attempt_count??0;
    const failed=(error:unknown):BridgeResponse=>{const detail=failure(error,attempts,effect);if(handler.semantics==='write'){detail.retryable=false;detail.nextAction='核对原业务执行记录或继续读取回执，不重新提交外部写操作';}return{schema:1,id:requestId,status:'error',error:detail,...(response.operationId?{operationId:response.operationId}:{})};};
    try{
      const current=this.runs.assertActive(runId),timeout=AbortSignal.timeout(Math.min(30000,handler.timeoutMs??30000)),signal=AbortSignal.any([current.signal,timeout,...(callerSignal?[callerSignal]:[])]);
      if(signal.aborted)return Promise.resolve(failed(new ApplicationError('CANCELED','本次回执核对已取消')));
      let onAbort!:()=>void;
      const interrupted=new Promise<BridgeResponse>(resolve=>{onAbort=()=>resolve(failed(new ApplicationError(interruptionCode(signal,timeout),'本次回执核对未完成，原执行记录保留')));signal.addEventListener('abort',onAbort,{once:true});});
      const verification=this.runs.withActivity(runId,async fresh=>{
        if(signal.aborted)throw new ApplicationError('CANCELED','本次回执核对已取消');handler.authorize(fresh,call.connectionId);
        if(response.operationId)await handler.authorizeReceipt?.(fresh,response.operationId,call.connectionId,signal);
        if(signal.aborted)throw new ApplicationError(interruptionCode(signal,timeout),'本次回执核对已取消');handler.authorize(this.runs.assertActive(runId),call.connectionId);return response;
      }).catch(failed);
      return Promise.race([verification,interrupted]).finally(()=>signal.removeEventListener('abort',onAbort));
    }catch(error){return Promise.resolve(failed(error));}
  }
  private async execute(runId: string,requestId: string,call: BridgeToolCall,hash: string,control: { signal: AbortSignal;deadline: number;timeout: AbortSignal }): Promise<BridgeResponse> {
    let operationId: string | undefined, attempts = 0, effect: BridgeFailure['effectState'] = 'not-started', exhausted = false;
    try {
      if (control.signal.aborted) throw new ApplicationError(interruptionCode(control.signal,control.timeout),'本次调用已取消');
      return await this.runs.withActivity(runId,async context => {
        const selected = this.selected(context,call), handler = this.handler(selected.application.packageHash,call.operation,call.contractMajor);
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
          if (signal.aborted) throw new ApplicationError(interruptionCode(signal,timeout),'调用已取消或到达本次时限');
          const fresh = this.runs.assertActive(runId); handler.authorize(fresh,call.connectionId); attempts++;
          effect = handler.semantics === 'read' ? 'read-only' : 'unknown';
          await withResourceLock(this.store.root,() => { this.store.sqlite.prepare('UPDATE application_invocations SET attempt_count=?,effect_state=? WHERE operation_id=?').run(attempts,effect,operationId); });
          if (signal.aborted) throw new ApplicationError(interruptionCode(signal,timeout),'执行前调用已取消');
          this.runs.assertActive(runId); handler.authorize(this.runs.assertActive(runId),call.connectionId);
          // An executor may ignore cancellation; its activity lease stays held until it really settles.
          try {
            const value = await handler.execute(fresh,call.arguments,{ operationId: operationId!,requestId,attempt: attempts,deadline,signal,packageHash: selected.application.packageHash,appId: selected.application.appId,toolName: call.operation,contractMajor: call.contractMajor,connectionId: call.connectionId,...(this.entry==='cli'?{entry:this.entry}:{}) });
            if (!boundedJson(value) || Buffer.byteLength(JSON.stringify(value)) > BRIDGE_LIMITS.responseBytes - 4096) throw new ApplicationError('TOO_LARGE','响应超过本次预算，请使用分页或有界资源');
            if (!outputValidator(value).valid) throw new ApplicationError('INVALID_RESPONSE','结果不符合固定工具输出契约');
            this.runs.assertActive(runId); handler.authorize(this.runs.assertActive(runId),call.connectionId);
            if (signal.aborted) throw new ApplicationError(interruptionCode(signal,timeout),'本次等待已结束，请查看已有业务执行记录');
            effect = handler.semantics === 'read' ? 'read-only' : 'completed'; await this.end(operationId!,'succeeded',attempts,effect,null);
            return { schema: 1 as const,id: requestId,status: 'ok' as const,value,operationId,effectState: effect };
          } catch (error) {
            const retryable = error instanceof ApplicationError && ['TRANSIENT_FAILURE','TIMEOUT','RESOURCE_BUSY'].includes(error.code);
            if (!canRetry || !retryable || signal.aborted) throw error;
            if (attempts >= 3) { exhausted = true; throw error; }
            const backoff = Math.min(5000,Math.max(0,this.options.retryDelays?.[attempts - 1] ?? ([1000,3000][attempts - 1] + Math.floor(Math.random() * 100))));
            const wait = Math.max(backoff,retryAfterWait(error));
            if (this.clock() + wait >= deadline) { exhausted = true; throw error; }
            try { await delay(wait,undefined,{ signal }); } catch { throw new ApplicationError(interruptionCode(signal,timeout),'重试等待已取消'); }
          }
        }
      });
    } catch (error) {
      // A cooperative producer reports local cancellation for either upstream
      // cause. Persist the original host deadline cause,without changing effect
      // state or interpreting an unknown write as canceled or retryable.
      const cause=error instanceof ApplicationError&&error.code==='CANCELED'&&control.signal.aborted&&interruptionCode(control.signal,control.timeout)==='TIMEOUT'?new ApplicationError('TIMEOUT','调用已到达本次时限，原业务结果按执行记录核对'):error;
      if (operationId && !(cause instanceof ApplicationError && cause.code === 'REPLAY_UNAVAILABLE')) await this.end(operationId,(effect as BridgeFailure['effectState']) === 'unknown' ? 'unknown' : 'failed',attempts,effect,cause instanceof ApplicationError ? cause.code : 'CAPABILITY_UNAVAILABLE');
      return { schema: 1,id: requestId,status: 'error',error: failure(cause,attempts,effect,exhausted),...(operationId ? { operationId } : {}) };
    }
  }
  private async end(id: string,state: 'succeeded' | 'failed' | 'unknown',attempts: number,effect: BridgeFailure['effectState'],code: string | null): Promise<void> {
    await withResourceLock(this.store.root,() => { this.store.sqlite.prepare('UPDATE application_invocations SET state=?,attempt_count=?,effect_state=?,error_code=?,ended_at=? WHERE operation_id=?').run(state,attempts,effect,code,new Date(this.clock()).toISOString(),id); });
  }
  clearMemory(runId: string): void { for (const [key,item] of this.cache) if (key.startsWith(runId + ':')) { this.cache.delete(key); this.cacheBytes -= item.bytes; } }
}
