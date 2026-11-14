import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  cliLoginSchema, codeAgentKindSchema, providerInputSchema, providerModelSchema,
  providerEndpointsSchema, runConfigInputSchema,
  type CodeAgentTool, type ProviderInput, type ProviderView, type RunConfigInput, type RunConfigView,
} from '@shared/ai-agents';
import type { AppDb } from '../../db/client';
import { aiProfiles, aiProviders, aiRunConfigs, aiTools, appSecrets } from '../../db/schema';
import type { SecretsStore } from '../../secrets';
import { verifiedPresetProtocol } from './provider-presets';
import { publicLocalMagpie } from '@shared/ai-provider-presets';

type ProviderRow = typeof aiProviders.$inferSelect;
type ConfigRow = typeof aiRunConfigs.$inferSelect;
const modelsOf = (row: ProviderRow) => z.array(providerModelSchema).parse(JSON.parse(row.models));
const endpointsOf = (row: ProviderRow) => providerEndpointsSchema.parse(JSON.parse(row.endpoints));
const recommendedSchema = z.object({ claude: z.string().optional(), codex: z.string().optional() });
const sameEndpoints = (a: ProviderRow, b: z.infer<typeof providerEndpointsSchema>) => {
  const old = endpointsOf(a);
  return (['anthropic', 'responses', 'openai'] as const).every((key) => old[key] === b[key]);
};

/** M13 metadata shares the existing profile IDs, task foreign keys and encrypted store. */
export class AgentService {
  // Ephemeral probe metadata: re-detection replaces/clears it, restart requires a new probe.
  private readonly toolLoginSources = new Map<string, NonNullable<CodeAgentTool['loginSourceEnv']>>();
  constructor(private readonly db: AppDb, private readonly secrets: SecretsStore, private readonly now = () => Date.now()) {}

  tools(): CodeAgentTool[] { return this.db.select().from(aiTools).orderBy(asc(aiTools.createdAt)).all().map(tool => {
    const source = this.toolLoginSources.get(tool.id);
    return source ? { ...tool, loginSourceEnv: source } : tool;
  }); }

  recordTool(input: CodeAgentTool): void { this.recordTools([input]); }

  recordTools(inputs: CodeAgentTool[]): void {
    this.db.transaction(() => {
      for (const detected of inputs) {
        const { loginSourceEnv: _source, ...input } = detected;
        codeAgentKindSchema.parse(input.kind); cliLoginSchema.parse(input.login);
        if (!input.id || !input.executable || typeof input.installed !== 'boolean') throw new Error('工具检测结果无效');
        const previous = this.db.select().from(aiTools).where(eq(aiTools.id, input.id)).get();
        if (previous && previous.kind !== input.kind) throw new Error('不能改变已有工具的 Code Agent 类型');
        this.db.insert(aiTools).values({ ...input, createdAt: this.now(), updatedAt: this.now() })
          .onConflictDoUpdate({ target: aiTools.id, set: { ...input, updatedAt: this.now() } }).run();
        for (const row of this.db.select().from(aiRunConfigs).where(eq(aiRunConfigs.toolId, input.id)).all()) {
          if (row.source !== 'login') continue;
          const loggedOut = input.login === 'none';
          // Only an actual logout→login transition restores visibility. An ordinary
          // refresh must not reopen a config the user deliberately hid.
          this.db.update(aiRunConfigs).set({ loggedOut, ...(loggedOut ? { homeVisible: false } : row.loggedOut ? { homeVisible: true } : {}) })
            .where(eq(aiRunConfigs.profileId, row.profileId)).run();
          if (!row.nameCustomized && !loggedOut) {
            const label = input.kind === 'codex' ? 'Codex' : 'Claude Code';
            const suffix = input.login === 'api' ? 'API' : input.login === 'subscription' ? '订阅' : '本机登录';
            const name = `${label} · ${suffix}`;
            if (!this.nameTaken(name, row.profileId)) this.db.update(aiProfiles).set({ name, updatedAt: this.now() }).where(eq(aiProfiles.id, row.profileId)).run();
          }
        }
      }
      // Wait until the complete scan is published before handing over the default.
      this.normalizeDefault();
    });
    // Publish only after the SQLite transaction succeeded; never persist probe output.
    for (const tool of inputs) {
      if (tool.kind === 'claude' && tool.installed && tool.login === 'api' && tool.loginSourceEnv === 'ANTHROPIC_API_KEY') this.toolLoginSources.set(tool.id, tool.loginSourceEnv);
      else this.toolLoginSources.delete(tool.id);
    }
  }

  providers(): ProviderView[] { return this.db.select().from(aiProviders).orderBy(asc(aiProviders.createdAt)).all().map((row) => this.providerView(row)); }

  saveProvider(input: ProviderInput, id?: string): ProviderView {
    const data = providerInputSchema.parse(input);
    return this.db.transaction(() => {
      const before = id ? this.requireProvider(id) : undefined;
      if (this.db.select().from(aiProviders).all().some((row) => row.id !== id && row.name === data.name)) throw new Error('供应商名称已存在');
      const providerId = id ?? randomUUID();
      const hadKey = Boolean(before && ((before.secretRef && this.secrets.has(before.secretRef)) || publicLocalMagpie(before.preset,endpointsOf(before))));
      let secretRef = before?.secretRef ?? null;
      let keyHint=before?.keyHint??null;
      if (data.key === null) {
        if (secretRef) this.secrets.delete(secretRef);
        secretRef = null;keyHint=null;
      } else if (data.key !== undefined) {
        secretRef ??= `provider:${providerId}:key`;
        this.secrets.set(secretRef, data.key);
        keyHint=[...data.key].length>4?[...data.key].slice(-4).join(''):null;
      }
      const identityChanged = Boolean(before && (!sameEndpoints(before, data.endpoints) || before.authType !== data.authType || (hadKey && data.key !== undefined)));
      const row = {
        id: providerId, name: data.name, preset: data.preset, endpoints: JSON.stringify(data.endpoints),
        authType: data.authType, secretRef, keyHint, identityRevision: (before?.identityRevision ?? 1) + Number(identityChanged),
        models: JSON.stringify(identityChanged ? data.models.map((model) => ({ ...model, availability: { claude: 'untested', codex: 'untested' }, checks: undefined })) : data.models), recommended: JSON.stringify(data.recommended),
        refreshedAt: identityChanged ? null : before?.refreshedAt ?? null, createdAt: before?.createdAt ?? this.now(), updatedAt: this.now(),
      };
      this.db.insert(aiProviders).values(row).onConflictDoUpdate({ target: aiProviders.id, set: row }).run();
      return this.providerView(row);
    });
  }

  configs(): RunConfigView[] {
    return this.db.select().from(aiRunConfigs).orderBy(asc(aiRunConfigs.sortOrder)).all().map((row) => {
      const profile = this.db.select().from(aiProfiles).where(eq(aiProfiles.id, row.profileId)).get();
      const tool = this.db.select().from(aiTools).where(eq(aiTools.id, row.toolId)).get();
      if (!profile || !tool) throw new Error('智能体关联数据缺失');
      return {
        id: row.profileId, name: profile.name, toolId: row.toolId, kind: tool.kind,
        source: row.source, providerId: row.providerId, models: z.array(z.string()).parse(JSON.parse(row.models)),
        defaultModel: row.defaultModel, homeVisible: row.homeVisible, isDefault: profile.isDefault,
        loggedOut: row.loggedOut, nameCustomized: row.nameCustomized, order: row.sortOrder,
        available: tool.installed && !row.loggedOut, legacyReason: row.legacyReason,
      };
    });
  }

  saveConfig(input: RunConfigInput, id?: string): RunConfigView {
    const data = runConfigInputSchema.parse(input);
    return this.db.transaction(() => {
      const tool = this.db.select().from(aiTools).where(eq(aiTools.id, data.toolId)).get();
      if (!tool || !tool.installed) throw new Error('Code Agent 尚未安装');
      const kind = codeAgentKindSchema.parse(tool.kind);
      const before = id ? this.requireConfig(id) : undefined;
      if (before?.source === 'legacy') throw new Error('旧配置请使用旧配置编辑入口');
      if (before && before.toolId !== tool.id) throw new Error('不能更换已有智能体的 Code Agent');
      if (this.nameTaken(data.name, id)) throw new Error('智能体名称已存在');
      const providerId = data.source === 'provider' ? data.providerId : null;
      if (this.configs().some((row) => row.id !== id && row.source !== 'legacy' && row.toolId === tool.id && row.source === data.source && row.providerId === providerId)) throw new Error('该组合已有智能体，请编辑已有智能体');
      let selected: string[] = [], defaultModel: string | null = null;
      if (data.source === 'provider') {
        if (!providerId) throw new Error('请选择供应商');
        const provider = this.requireProvider(providerId), endpoints = endpointsOf(provider);
        if (!(kind === 'claude' ? endpoints.anthropic : endpoints.responses)) throw new Error('供应商不支持该 Code Agent 所需协议');
        if (!verifiedPresetProtocol(provider.preset, endpoints, kind) && !modelsOf(provider).some((model) => !model.offline && model.availability[kind] === 'available')) throw new Error('自定义供应商须先验证该协议的模型工具调用');
        const allowed = new Set(modelsOf(provider).filter((model) => !model.offline && model.availability[kind] !== 'unavailable').map((model) => model.id));
        selected = [...new Set(data.models)].filter((model) => allowed.has(model));
        if (!selected.length) throw new Error('至少选择一个可用或未测试的模型');
        defaultModel = data.defaultModel && selected.includes(data.defaultModel) ? data.defaultModel : selected[0];
      } else if (tool.login === 'none') throw new Error('请先在终端登录该 Code Agent');
      const profileId = id ?? randomUUID();
      this.db.insert(aiProfiles).values({ id: profileId, name: data.name, runner: tool.kind, executable: tool.executable, env: '[]', args: '[]', isDefault: false, createdAt: this.now(), updatedAt: this.now() })
        .onConflictDoUpdate({ target: aiProfiles.id, set: { name: data.name, updatedAt: this.now() } }).run();
      this.db.insert(aiRunConfigs).values({ profileId, toolId: tool.id, source: data.source, providerId, models: JSON.stringify(selected), defaultModel,
        homeVisible: data.homeVisible, nameCustomized: data.nameCustomized, loggedOut: false,
        sortOrder: before?.sortOrder ?? this.configs().length, migrationVersion: 1 })
        .onConflictDoUpdate({ target: aiRunConfigs.profileId, set: { source: data.source, providerId, models: JSON.stringify(selected), defaultModel,
          homeVisible: data.homeVisible, nameCustomized: data.nameCustomized, loggedOut: false } }).run();
      if (data.isDefault) {
        if (!data.homeVisible) throw new Error('首页隐藏的智能体不能设为默认');
        this.chooseDefault(profileId);
      } else {
        const wasDefault = this.db.select().from(aiProfiles).where(eq(aiProfiles.id, profileId)).get()?.isDefault;
        if (wasDefault && !data.homeVisible) throw new Error('不能关闭默认智能体的首页显示');
        this.normalizeDefault();
      }
      return this.configs().find((row) => row.id === profileId)!;
    });
  }

  /** Reconcile after one atomic external import, retaining a still-valid default. */
  reconcileDefaults():void { this.db.transaction(()=>this.normalizeDefault()); }

  setHomeVisible(id:string,visible:boolean):void{
    if(typeof visible!=='boolean')throw new Error('首页显示值无效');
    this.db.transaction(()=>{
      const row=this.requireConfig(id),view=this.configs().find(c=>c.id===id)!;
      if(row.homeVisible===visible)return;
      if(!visible&&view.isDefault)throw new Error('不能关闭默认智能体的首页显示');
      if(visible&&!view.available)throw new Error('工具未安装或已退出登录，暂时不能在首页显示');
      this.db.update(aiRunConfigs).set({homeVisible:visible}).where(eq(aiRunConfigs.profileId,id)).run();this.normalizeDefault();
    });
  }

  setDefault(id: string): void { this.db.transaction(() => this.chooseDefault(id)); }

  reorder(id: string, index: number): void {
    this.db.transaction(() => {
      const rows = this.configs(), current = rows.find((row) => row.id === id);
      if (!current) throw new Error('智能体不存在');
      if (current.isDefault) throw new Error('默认智能体固定在第一位');
      const rest = rows.filter((row) => row.id !== id);
      const target = Math.max(rest[0]?.isDefault ? 1 : 0, Math.min(Number.isInteger(index) ? index : 0, rest.length));
      rest.splice(target, 0, current); this.writeOrder(rest.map((row) => row.id));
    });
  }

  deleteConfig(id: string): void {
    this.db.transaction(() => { this.requireConfig(id); this.removeProfile(id); this.normalizeDefault(); });
  }

  deleteProvider(id: string): string[] {
    return this.db.transaction(() => {
      const provider = this.requireProvider(id);
      const ids = this.db.select().from(aiRunConfigs).where(eq(aiRunConfigs.providerId, id)).all().map((row) => row.profileId);
      for (const profileId of ids) this.removeProfile(profileId);
      this.db.delete(aiProviders).where(eq(aiProviders.id, id)).run();
      if (provider.secretRef) this.secrets.delete(provider.secretRef);
      this.normalizeDefault(); return ids;
    });
  }

  private requireProvider(id: string): ProviderRow {
    const row = this.db.select().from(aiProviders).where(eq(aiProviders.id, id)).get();
    if (!row) throw new Error('供应商不存在'); return row;
  }
  private requireConfig(id: string): ConfigRow {
    const row = this.db.select().from(aiRunConfigs).where(eq(aiRunConfigs.profileId, id)).get();
    if (!row) throw new Error('智能体不存在'); return row;
  }
  private providerView(row: ProviderRow): ProviderView {
    return { id: row.id, name: row.name, preset: row.preset, endpoints: endpointsOf(row), authType: row.authType,
      keyHint:row.secretRef?row.keyHint:null,hasKey: Boolean(row.secretRef && this.secrets.has(row.secretRef)) || publicLocalMagpie(row.preset,endpointsOf(row)), identityRevision: row.identityRevision,
      models: modelsOf(row), recommended: recommendedSchema.parse(JSON.parse(row.recommended)), refreshedAt: row.refreshedAt };
  }
  private nameTaken(name: string, except?: string): boolean {
    return this.configs().some((row) => row.id !== except && row.source !== 'legacy' && row.name === name);
  }
  private chooseDefault(id: string): void {
    const rows = this.configs(), target = rows.find((row) => row.id === id);
    if (!target?.available || !target.homeVisible) throw new Error('只能将首页显示且可用的智能体设为默认');
    this.db.update(aiProfiles).set({ isDefault: false }).run();
    this.db.update(aiProfiles).set({ isDefault: true }).where(eq(aiProfiles.id, id)).run();
    this.writeOrder([id, ...rows.filter((row) => row.id !== id).map((row) => row.id)]);
  }
  private normalizeDefault(): void {
    const rows = this.configs(), current = rows.find((row) => row.isDefault && row.available && row.homeVisible);
    const target = current ?? rows.find((row) => row.available && row.homeVisible);
    if (target) this.chooseDefault(target.id);
    else { this.db.update(aiProfiles).set({ isDefault: false }).run(); this.writeOrder(rows.map((row) => row.id)); }
  }
  private writeOrder(ids: string[]): void { ids.forEach((id, sortOrder) => this.db.update(aiRunConfigs).set({ sortOrder }).where(eq(aiRunConfigs.profileId, id)).run()); }
  private removeProfile(id: string): void {
    const prefix = `ai:${id}:env:`;
    const providerRefs = new Set(this.db.select({ ref: aiProviders.secretRef }).from(aiProviders).all().map((row) => row.ref));
    for (const { key } of this.db.select({ key: appSecrets.key }).from(appSecrets).all()) if (key.startsWith(prefix) && !providerRefs.has(key)) this.secrets.delete(key);
    this.db.delete(aiProfiles).where(eq(aiProfiles.id, id)).run();
  }
}
