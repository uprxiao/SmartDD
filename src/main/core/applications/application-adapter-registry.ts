import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { z } from 'zod';
import { ApplicationError, type InstalledApplicationPackage } from '@shared/applications';
import { boundedJson } from '@shared/application-bridge';
import { BuiltinPackageRegistry } from './builtin-package-registry';
import { canonicalJson, digest } from './manifest';
import type { RunContext } from './run-registry';
import { RuntimeRegistry } from './runtime-registry';
import type { ResourceStore } from './resource-store';
import type { ApplicationToolHost, HostToolOperation } from './tool-service';

const descriptor = z.object({
  method: z.string().regex(/^(zentao|mail)\.[a-z][a-z0-9.-]*$/).max(128),
  semantics: z.enum(['read','write']), retry: z.enum(['safe-read','never']),
  timeoutMs: z.number().int().min(1).max(120000),
}).strict();
type Descriptor = z.infer<typeof descriptor>;
interface FixedApplicationAdapter {
  api: 1; dataApi: 1; appId: string; version: string;
  operations: Record<string,Descriptor>;
  execute(name: string,input: Record<string,unknown>,data: { v1: { invoke(method: string,input: Record<string,unknown>): Promise<unknown> } }): Promise<unknown>;
}
export interface ApplicationDataBinding { packageHash: string;appId: string;toolName: string;permission: string }
/** Implemented by host services; a package never receives SQLite, a secret or an arbitrary RPC method. */
export interface ApplicationDataHost {
  resolve(version: 1,method: string,binding: Readonly<ApplicationDataBinding>): HostToolOperation;
}

/** Executes only indexed built-ins, by the session's original hash. This is not a third-party-code sandbox. */
export class ApplicationAdapterRegistry implements ApplicationToolHost {
  private readonly builtin: BuiltinPackageRegistry;
  private readonly runtimes: RuntimeRegistry;
  private readonly cache = new Map<string,FixedApplicationAdapter>();
  constructor(readonly store: ResourceStore,private readonly data: ApplicationDataHost) {
    this.builtin = new BuiltinPackageRegistry(store);
    this.runtimes = new RuntimeRegistry(store);
  }

  private load(hash: string): {application: InstalledApplicationPackage;adapter: FixedApplicationAdapter} {
    const application = this.builtin.assertTrusted(hash);
    this.runtimes.verify(application.manifest.runtime.hash,application.manifest.runtime);
    const cached = this.cache.get(hash);
    if (cached) return {application,adapter: cached};
    const root = join(this.store.root,application.relativePath);
    const read = (path: string): Buffer => {
      const file = application.manifest.files.find(f => f.path === path);
      if (!file) throw new ApplicationError('INVALID_PACKAGE','固定适配器资源未在原包中声明');
      const bytes = readFileSync(join(root,path));
      if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new ApplicationError('HASH_MISMATCH','固定适配器资源与原内容不同');
      return bytes;
    };
    const code = read(application.manifest.adapter.entry).toString('utf8');
    let operations: {appId:string;version:string;operations:Record<string,Descriptor>};
    try {
      operations = z.object({appId:z.string(),version:z.string(),operations:z.record(z.string(),descriptor)}).strict().parse(JSON.parse(read('adapter/operations.json').toString('utf8')));
    } catch { throw new ApplicationError('INVALID_PACKAGE','固定适配器操作表无效'); }
    if (operations.appId !== application.appId || operations.version !== application.version || Object.keys(operations.operations).length !== application.manifest.tools.length) throw new ApplicationError('INVALID_PACKAGE','固定适配器操作表与原包身份或工具集合不同');
    for (const tool of application.manifest.tools) {
      const operation = operations.operations[tool.name];
      if (!operation || !operation.method.startsWith(application.appId + '.') || (operation.semantics === 'read') !== tool.annotations.readOnlyHint || (operation.semantics === 'write' && operation.retry !== 'never')) throw new ApplicationError('INVALID_PACKAGE','固定工具的业务语义或重试声明不一致');
      Object.freeze(operation);
    }
    Object.freeze(operations.operations);Object.freeze(operations);
    const module: {exports:unknown} = {exports:{}};
    try {
      // The only import available to these trusted, pure dispatchers is their verified route table.
      new Script(code,{filename:application.manifest.adapter.entry}).runInNewContext({
        module, exports: module.exports,
        require: (path: string) => {
          if (path !== './operations.json') throw new ApplicationError('HOST_INCOMPATIBLE','此固定适配器仅支持注入的版本化Data API');
          return operations;
        },
      },{timeout:2000,contextCodeGeneration:{strings:false,wasm:false}});
    } catch { throw new ApplicationError('HOST_INCOMPATIBLE','固定应用适配器无法在当前宿主初始化'); }
    const adapter = module.exports as FixedApplicationAdapter;
    if (!adapter || adapter.api !== 1 || adapter.dataApi !== 1 || adapter.appId !== application.appId || adapter.version !== application.version || typeof adapter.execute !== 'function' || canonicalJson(adapter.operations) !== canonicalJson(operations.operations)) throw new ApplicationError('HOST_INCOMPATIBLE','固定应用适配器不符合原Data API契约');
    this.cache.set(hash,adapter);
    return {application,adapter};
  }

  resolve(packageHash: string,toolName: string,contractMajor: number): HostToolOperation {
    const {application,adapter} = this.load(packageHash);
    const tool = application.manifest.tools.find(t => t.name === toolName && t.contractMajor === contractMajor);
    const route = adapter.operations[toolName];
    if (!tool || !route) throw new ApplicationError('SCOPE_DENIED','工具不属于此固定应用版本');
    const binding = Object.freeze({packageHash,appId:application.appId,toolName,permission:tool.permission});
    const handler = this.data.resolve(1,route.method,binding);
    if (handler.semantics !== route.semantics || (route.semantics === 'write' && handler.retry !== 'never')) throw new ApplicationError('HOST_INCOMPATIBLE','宿主Data API执行语义与原包不兼容');
    const authorize = (context: RunContext,connectionId: string | null): void => {
      const selected = context.snapshot.packages.find(p => p.packageHash === packageHash && p.appId === application.appId);
      if (!selected || selected.toolContractMajors[toolName] !== contractMajor || !selected.allowedOperations.includes(tool.permission)) throw new ApplicationError('SCOPE_DENIED','当前运行未选用此原包工具或动作');
      handler.authorize(context,connectionId);
    };
    return {
      semantics:route.semantics,
      retry:handler.retry === 'never' ? 'never' : route.retry,
      timeoutMs:Math.min(route.timeoutMs,handler.timeoutMs ?? route.timeoutMs),
      authorize,
      authorizeReceipt:handler.authorizeReceipt?(context,operationId,connectionId,signal)=>{authorize(context,connectionId);return handler.authorizeReceipt!(context,operationId,connectionId,signal);}:undefined,
      execute:async (context,input,operation) => {
        this.load(packageHash); // Verify original bytes and provenance even when the module was cached.
        if (operation.packageHash !== packageHash || operation.appId !== application.appId || operation.toolName !== toolName || operation.contractMajor !== contractMajor) throw new ApplicationError('SCOPE_DENIED','执行上下文不能替换原包或工具');
        authorize(context,operation.connectionId);
        let calls = 0;
        const data = Object.freeze({v1:Object.freeze({invoke:async (method: string,args: Record<string,unknown>) => {
          if (method !== route.method || calls++ !== 0) throw new ApplicationError('SCOPE_DENIED','一次工具调用只能执行其固定的Data API动作');
          if (!boundedJson(args) || !args || Array.isArray(args) || typeof args !== 'object') throw new ApplicationError('INVALID_INPUT','Data API参数必须是有界对象');
          authorize(context,operation.connectionId);
          return handler.execute(context,args,operation);
        }})});
        const value = await adapter.execute(toolName,input,data);
        if (calls !== 1) throw new ApplicationError('INVALID_RESPONSE','固定适配器没有执行所声明的Data API动作');
        return value;
      },
    };
  }
}
