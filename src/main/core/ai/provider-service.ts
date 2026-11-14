import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { codeAgentKindSchema, providerInputSchema, providerModelSchema, type CodeAgentKind, type ProviderInput, type ProviderModel, type ProviderView } from '@shared/ai-agents';
import type { AppDb } from '../../db/client';
import { aiProviders, appSecrets } from '../../db/schema';
import type { SecretsStore } from '../../secrets';
import type { AgentService } from './agent-service';
import { fetchProviderModels, probeProviderProtocol, providerTargetForTool, ProviderRequestError, verifyProviderModel, type ProviderClientOptions, type ProviderTarget } from './provider-client';
import { publicLocalMagpie, verifiedPresetProtocol } from '@shared/ai-provider-presets';
import { recommendedProviderModel } from '@shared/provider-catalog';
import { presetModelMetadata } from './provider-metadata';

type ProviderRow = typeof aiProviders.$inferSelect;

/** Network work stays in main; renderer-supplied availability is never authoritative. */
export class ProviderService {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly mutations = new Map<string, number>();
  constructor(private readonly db: AppDb, private readonly secrets: SecretsStore, private readonly agents: AgentService,
    private readonly client: ProviderClientOptions = {}, private readonly now = () => Date.now()) {}

  save(input: ProviderInput, id?: string): ProviderView {
    const data = providerInputSchema.parse(input);
    const previous = id ? this.agents.providers().find((row) => row.id === id) : undefined;
    const oldModels = new Map(previous?.models.map((model) => [model.id, model]));
    // Availability and error history can only come from saved main-process checks.
    const models = data.models.map((model) => ({ ...model,
      availability: oldModels.get(model.id)?.availability ?? { claude: 'untested' as const, codex: 'untested' as const },
      checks: oldModels.get(model.id)?.checks,
    }));
    const saved = this.agents.saveProvider({ ...data, models }, id);
    this.mutations.set(saved.id, (this.mutations.get(saved.id) ?? 0) + 1);
    return saved;
  }

  delete(id: string): string[] {
    const deleted = this.agents.deleteProvider(id);
    this.mutations.set(id, (this.mutations.get(id) ?? 0) + 1);
    return deleted;
  }

  /** Setup requests do not create a Provider, a Key reference or an Agent. */
  async previewDraft(input:ProviderInput,signal?:AbortSignal){
    const {data,target,options,check}=this.draft(input,signal);
    let models:ProviderModel[],note:string|undefined;
    try{models=presetModelMetadata(data.preset,data.endpoints,await fetchProviderModels(target,options));}
    catch(error){if(error instanceof ProviderRequestError&&error.status===404){models=[];note='模型列表接口不存在，请手动填写模型 ID';}else throw error;}
    check();
    return {models,recommended:{claude:recommendedProviderModel(data.preset,models,'claude'),codex:recommendedProviderModel(data.preset,models,'codex')},
      note:note??(!models.length?'模型列表为空，请手动填写模型 ID':null)};
  }
  async probeDraft(input:ProviderInput,kind:CodeAgentKind,signal?:AbortSignal){
    codeAgentKindSchema.parse(kind);const {target,options,check}=this.draft(input,signal);
    const result=await probeProviderProtocol(target,kind,options);check();return result;
  }
  async connect(input:ProviderInput,signal?:AbortSignal):Promise<ProviderView>{
    const {data,target,options,check}=this.draft(input,signal);
    if(!data.models.length)throw new ProviderRequestError('请至少勾选或手动填写一个模型');
    let models=presetModelMetadata(data.preset,data.endpoints,data.models.map(m=>({...m,availability:{claude:'untested',codex:'untested'},checks:undefined})));
    if(publicLocalMagpie(data.preset,data.endpoints)){
      const current=await fetchProviderModels(target,options);check();
      models=data.models.map(selected=>{const model=current.find(m=>m.id===selected.id&&!m.offline);if(!model)throw new ProviderRequestError('选中的模型已下线，请重新获取模型');return model;});
    }
    const endpoints={...data.endpoints},recommended:{claude?:string;codex?:string}={};
    const successful:CodeAgentKind[]=[],failures:string[]=[];
    for(const kind of ['claude','codex'] as const){
      if(!(kind==='claude'?endpoints.anthropic:endpoints.responses))continue;
      check();const preferred=data.recommended[kind];
      const id=models.some(m=>m.id===preferred&&!m.offline&&m.availability[kind]!=='unavailable')?preferred:recommendedProviderModel(data.preset,models,kind);
      if(!id)continue;
      const result=await verifyProviderModel(target,kind,id,options);check();
      const model=models.find(m=>m.id===id)!;model.availability[kind]=result.status;model.checks={...model.checks,[kind]:{...result,checkedAt:this.now()}};recommended[kind]=id;
      if(result.status==='available')successful.push(kind);
      else{
        failures.push(result.message);
        if(result.failures.some(f=>f.status===401||f.status===403))throw new ProviderRequestError(result.message,result.failures.at(-1)?.status??null);
        if(!verifiedPresetProtocol(data.preset,endpoints,kind))delete endpoints[kind==='claude'?'anthropic':'responses'];
      }
    }
    check();
    if(!endpoints.anthropic&&!endpoints.responses&&!endpoints.openai)throw new ProviderRequestError(failures[0]??'没有可用的协议，未保存供应商');
    if(!successful.length&&!endpoints.openai&&!(['claude','codex'] as const).some(kind=>verifiedPresetProtocol(data.preset,endpoints,kind)))throw new ProviderRequestError(failures[0]??'模型工具调用未通过，未保存供应商');
    // Trusted checks are produced above in main; the ordinary save RPC rejects
    // renderer-forged statuses. No async work occurs inside this transaction.
    return this.agents.saveProvider({...data,endpoints,models,recommended});
  }

  private draft(input:ProviderInput,signal?:AbortSignal){
    const data=providerInputSchema.parse(input),key=data.key??(publicLocalMagpie(data.preset,data.endpoints)?'magpie':null);
    if(!key)throw new ProviderRequestError('需要填写 Key');
    const check=()=>{if(signal?.aborted||this.client.signal?.aborted)throw new ProviderRequestError('请求已取消');};check();
    return {data,target:{endpoints:data.endpoints,key,authType:data.authType,preset:data.preset} satisfies ProviderTarget,
      options:{...this.client,...(signal?{signal:this.client.signal?AbortSignal.any([this.client.signal,signal]):signal}:{})},check};
  }

  /** Main-process launch handoff only. Never register this as a renderer RPC. */
  runtimeConnection(id: string,kind?:CodeAgentKind): { target: ProviderTarget; assertCurrent: () => void } {
    const captured = this.capture(id);
    const generation = this.generation(captured.row);
    return { target: kind?providerTargetForTool(captured.target,kind):captured.target, assertCurrent: () => {
      if (this.generation(this.row(id)) !== generation) throw new Error('供应商认证已变化，请重新启动');
    } };
  }

  refresh(id: string, signal?: AbortSignal): Promise<ProviderView> {
    return this.serial(id, async () => {
      if(signal?.aborted)throw new Error('请求已取消');
      const captured = this.capture(id);
      const options={...this.client,...(signal?{signal:this.client.signal?AbortSignal.any([this.client.signal,signal]):signal}:{})};
      const received = z.array(providerModelSchema).max(4096).parse(presetModelMetadata(captured.row.preset,captured.target.endpoints,await fetchProviderModels(captured.target, options)));
      if(signal?.aborted)throw new Error('请求已取消');
      this.assertCurrent(id, captured.fingerprint);
      const old = new Map(this.models(captured.row).map((model) => [model.id, model]));
      const present = new Set(received.map((model) => model.id));
      const magpie=publicLocalMagpie(captured.row.preset,captured.target.endpoints);
      const models: ProviderModel[] = received.map((model) => {
        const previous=old.get(model.id);
        const availability={...model.availability},checks={...previous?.checks};
        for(const kind of ['claude','codex'] as const){
          if(magpie&&model.availability[kind]==='unavailable'){availability[kind]='unavailable';delete checks[kind];}
          else availability[kind]=magpie&&previous?.availability[kind]==='unavailable'&&!previous.checks?.[kind]?'untested':previous?.availability[kind]??model.availability[kind];
        }
        return {...model,availability,...(Object.keys(checks).length?{checks}:{checks:undefined})};
      });
      for (const model of old.values()) if (!present.has(model.id)) models.push({ ...model, offline: true });
      if (models.length > 4096) throw new Error('合并后的模型目录超过大小限制');
      this.db.update(aiProviders).set({ models: JSON.stringify(models), refreshedAt: this.now(), updatedAt: this.now() }).where(eq(aiProviders.id, id)).run();
      return this.view(id);
    });
  }

  async refreshForLaunch(id:string,kind:CodeAgentKind,signal?:AbortSignal):Promise<ProviderView>{
    codeAgentKindSchema.parse(kind);
    if(signal?.aborted||this.client.signal?.aborted)throw new Error('请求已取消');
    const provider=this.view(id);
    const manual=provider.models.length>0&&provider.models.every(model=>model.catalogSource==='manual')&&!publicLocalMagpie(provider.preset,provider.endpoints);
    if(!manual)return this.refresh(id,signal);
    return this.serial(id,async()=>{
      if(signal?.aborted||this.client.signal?.aborted)throw new Error('请求已取消');
      const captured=this.capture(id),models=this.models(captured.row);
      if(!models.length||!models.every(model=>model.catalogSource==='manual')||publicLocalMagpie(captured.row.preset,captured.target.endpoints))throw new Error('模型列表来源已变化，请重新启动');
      const options={...this.client,...(signal?{signal:this.client.signal?AbortSignal.any([this.client.signal,signal]):signal}:{})};
      const result=await probeProviderProtocol(captured.target,kind,options);
      if(signal?.aborted||this.client.signal?.aborted)throw new Error('请求已取消');
      this.assertCurrent(id,captured.fingerprint);
      // This is endpoint reachability only. It neither promotes model checks nor
      // replaces the user's manual list with a failed/empty remote directory.
      if(!(result.status>=200&&result.status<300)&&![400,422].includes(result.status))throw new ProviderRequestError(`供应商接口不可用（HTTP ${result.status}）`,result.status);
      return this.view(id);
    });
  }

  probe(id: string, kind: CodeAgentKind) {
    codeAgentKindSchema.parse(kind);
    return this.serial(id, async () => {
      const captured = this.capture(id);
      const result = await probeProviderProtocol(captured.target, kind, this.client);
      this.assertCurrent(id, captured.fingerprint);
      return result; // A candidate never changes confirmed model availability.
    });
  }

  check(id: string, kind: CodeAgentKind, modelId: string): Promise<ProviderView> {
    codeAgentKindSchema.parse(kind);
    return this.serial(id, async () => {
      const captured = this.capture(id), models = this.models(captured.row);
      const model = models.find((item) => item.id === modelId);
      if (!model || model.offline) throw new Error('模型已下线或不存在，请刷新目录');
      const result = await verifyProviderModel(captured.target, kind, modelId, this.client);
      this.assertCurrent(id, captured.fingerprint);
      // User cancellation is neither a model failure nor a compatibility result.
      if (this.client.signal?.aborted) throw new Error('请求已取消');
      model.availability = { ...model.availability, [kind]: result.status };
      model.checks = { ...model.checks, [kind]: { ...result, checkedAt: this.now() } };
      this.db.update(aiProviders).set({ models: JSON.stringify(models), updatedAt: this.now() }).where(eq(aiProviders.id, id)).run();
      return this.view(id);
    });
  }

  private serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    // Bind the user's action to its source now, not to whichever identity exists
    // when another long-running request finally releases this Provider's queue.
    const generation = this.generation(this.row(id));
    const work = (this.queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(() => {
      if (this.generation(this.row(id)) !== generation) throw new Error('供应商已变更，排队请求已取消，请重新执行');
      return action();
    });
    this.queues.set(id, work);
    void work.finally(() => { if (this.queues.get(id) === work) this.queues.delete(id); }).catch(() => undefined);
    return work;
  }

  private row(id: string): ProviderRow {
    const row = this.db.select().from(aiProviders).where(eq(aiProviders.id, id)).get();
    if (!row) throw new Error('供应商不存在');
    return row;
  }
  private models(row: ProviderRow) { return z.array(providerModelSchema).parse(JSON.parse(row.models)); }
  private view(id: string): ProviderView { return this.agents.providers().find((row) => row.id === id)!; }
  private fingerprint(row: ProviderRow): string {
    const cipher = row.secretRef ? this.db.select().from(appSecrets).where(eq(appSecrets.key, row.secretRef)).get()?.secret : null;
    return createHash('sha256').update(JSON.stringify([row, cipher, this.mutations.get(row.id) ?? 0])).digest('hex');
  }
  private generation(row: ProviderRow): string {
    const cipher = row.secretRef ? this.db.select().from(appSecrets).where(eq(appSecrets.key, row.secretRef)).get()?.secret : null;
    return createHash('sha256').update(JSON.stringify([row.id, row.name, row.endpoints, row.authType, row.identityRevision, cipher, this.mutations.get(row.id) ?? 0])).digest('hex');
  }
  private capture(id: string) {
    const row = this.row(id), fingerprint = this.fingerprint(row);
    const endpoints=JSON.parse(row.endpoints);
    const key = (row.secretRef ? this.secrets.get(row.secretRef) : null) ?? (publicLocalMagpie(row.preset,endpoints)?'magpie':null);
    if (!key) throw new Error('需要填写 Key');
    const target: ProviderTarget = { endpoints, key, authType: row.authType,preset:row.preset };
    return { row, fingerprint, target };
  }
  private assertCurrent(id: string, fingerprint: string): void {
    const current = this.row(id);
    if (this.fingerprint(current) !== fingerprint) throw new Error('供应商已变更，本次结果未保存，请重新执行');
  }
}
