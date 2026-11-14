import { join } from 'node:path';
import { readCodexGlobalSettings, codexGlobalSettingsChanged } from './codex-global-config';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { agentRunSnapshotSchema, agentSourceIdentitySchema, type AgentRunSnapshot, type AgentSourceIdentity } from '@shared/agent-run-state';
import type { AgentPermission } from '@shared/agent-permissions';
import type { CodeAgentKind } from '@shared/ai-agents';
import type { TaskRecovery } from '@shared/tasks';
import type { AppDb } from '../../db/client';
import { aiProfiles, aiTaskSnapshots, appSecrets } from '../../db/schema';
import { builtinRunnerAdapters } from '../tasks/runner-adapters';
import type { AgentService } from './agent-service';
import type { AgentToolService } from './agent-tools';
import type { ProviderService } from './provider-service';
import type { AiProfileService, ResolvedProfile } from './ai-profile-service';
import { planAgentLaunch } from './agent-launch-plan';
import { materializeAgentPlan } from './agent-launch-files';
import { agentSourceIdentity, assertResumeSource, resumeModel } from './agent-run-state';
import { copyClaudeSession, readCodexProviderId, readRequestedModel, type ClaudeRestoreReceipt } from './agent-native-state';
import { overlayLegacyPermission } from './legacy-permission-overlay';
import type { SkillProjectionService } from '../capabilities/skill-projection';
import type { McpProjectionService } from '../capabilities/mcp-projection';

export interface AgentRestoreInput {
  taskId: string; runner: string; stateRoot: string | null; sessionId: string | null;
  since: number; recovery: TaskRecovery; explicitlySelected: boolean; acceptModelChange: boolean;
  expectedModel?: string | null; sourceConfirmation?: AgentSourceIdentity;
  /** Main-only admission while the host's native-history gate is held. */
  beforeHistoryCopy?(input:{from:string;to:string;cwd:string;sessionId:string;home:string}):Promise<void>;
}
export interface PreparedAgentRun {
  profile: ResolvedProfile;
  snapshot(stateRoot: string, startedAt: number): AgentRunSnapshot;
  assertCurrent(): void;
  restoreRoot?: ClaudeRestoreReceipt;
}
export interface AgentRuntimeOptions {
  db: AppDb; agents: AgentService; tools: Pick<AgentToolService,'refresh'>;
  providers: ProviderService; profiles: AiProfileService; userData: string;
  baseEnv(): Record<string,string>;
  permissionPreferences?(): {selected:AgentPermission;fullConfirmed:boolean};
  skills?:Pick<SkillProjectionService,'prepare'>;
  mcp?:Pick<McpProjectionService,'prepare'>;
}

/** M13 Agents share the existing TaskService lifecycle. This coordinator
 * only prepares checked native inputs; it never spawns a second untracked CLI.
 */
export class AgentRuntimeService {
  constructor(private readonly d: AgentRuntimeOptions) {}

  /** Resolve just-in-time source references for a selected managed MCP. This
   * does not materialize files, probe a model, refresh auth or start a process. */
  sourceEnvironment(profileId:string):Record<string,string>{
    const config=this.d.agents.configs().find(x=>x.id===profileId);
    if(!config||config.source==='legacy')return this.d.profiles.resolve(profileId).env;
    const tool=this.d.agents.tools().find(x=>x.id===config.toolId);if(!tool)throw new Error('来源 Code Agent 已删除');
    const provider=config.providerId?this.d.agents.providers().find(x=>x.id===config.providerId):undefined;
    if(config.source==='provider'&&!provider)throw new Error('来源供应商已删除');
    if(config.kind!=='claude'&&config.kind!=='codex')throw new Error('来源 Code Agent 暂不支持');
    const connection=provider?this.d.providers.runtimeConnection(provider.id,config.kind):undefined;
    return planAgentLaunch({config,tool,provider,key:connection?.target.key,permission:'ask',cwd:this.d.userData,userData:this.d.userData,runId:randomUUID()}).profile.env;
  }

  snapshot(taskId: string): AgentRunSnapshot | null {
    const row = this.d.db.select().from(aiTaskSnapshots).where(eq(aiTaskSnapshots.taskId,taskId)).get();
    if (!row) return null;
    const parsed = agentRunSnapshotSchema.safeParse(JSON.parse(row.snapshot));
    if (!parsed.success) throw new Error('任务智能体快照已损坏，无法安全恢复');
    return parsed.data;
  }
  /** Called inside the TaskService task-record transaction. */
  save(taskId: string, snapshot: AgentRunSnapshot): void {
    const value = JSON.stringify(agentRunSnapshotSchema.parse(snapshot));
    this.d.db.insert(aiTaskSnapshots).values({ taskId,snapshot:value }).onConflictDoUpdate({ target:aiTaskSnapshots.taskId,set:{snapshot:value} }).run();
  }

  /** Called only for this task's currently owned exiting PTY. */
  finish(taskId:string):void {
    const snap=this.snapshot(taskId);if(!snap?.codexGlobal)return;
    const after=readCodexGlobalSettings(snap.stateRoot);
    this.save(taskId,{...snap,codexGlobal:{...snap.codexGlobal,after,changed:snap.codexGlobal.before.status==='unreadable'||after.status==='unreadable'||codexGlobalSettingsChanged(snap.codexGlobal.before,after)}});
  }

  globalNotices(){
    return this.d.db.select().from(aiTaskSnapshots).all().flatMap(row=>{
      let value:unknown;try{value=JSON.parse(row.snapshot);}catch{return [];}
      const parsed=agentRunSnapshotSchema.safeParse(value);
      const g=parsed.success?parsed.data.codexGlobal:undefined;
      return g?.changed&&!g.dismissed?[{taskId:row.taskId,...g}]:[];
    });
  }
  dismissGlobalNotice(taskId:string){const snap=this.snapshot(taskId);if(snap?.codexGlobal)this.save(taskId,{...snap,codexGlobal:{...snap.codexGlobal,dismissed:true}});}
  globalConfigPath(taskId:string){const snap=this.snapshot(taskId);if(!snap?.codexGlobal||snap.codexGlobal.path!==join(snap.stateRoot,'config.toml'))throw new Error('没有可打开的 Codex 配置记录');return snap.codexGlobal.path;}

  preview(profileId:string,cwd:string,restore:Omit<AgentRestoreInput,'explicitlySelected'|'acceptModelChange'>){
    const config=this.d.agents.configs().find((row)=>row.id===profileId);
    if(!config)return null;
    if(config.source==='legacy'){
      const previous=this.snapshot(restore.taskId);
      if(previous?.identity.source!=='legacy'){
        if(previous)throw new Error('旧配置包含未识别的运行参数，无法确认原任务的权限与来源；请另选可核验的智能体恢复');
        return null;
      }
      const tool=this.d.agents.tools().find(row=>row.id===config.toolId);if(!tool)throw new Error('Code Agent 已删除，请重新选择');
      const current={...agentSourceIdentity(config,tool),legacyRevision:this.legacyRevision(config.id)};
      if(current.kind!==restore.runner)throw new Error('只能选择同一个 Code Agent 的智能体恢复');
      let sourceChanged=false;try{assertResumeSource(previous.identity,current,false);}catch{sourceChanged=true;}
      return {previous,current,sourceChanged,model:resumeModel(config,undefined,this.restoreModel(cwd,restore,previous))};
    }
    const tool=this.d.agents.tools().find((row)=>row.id===config.toolId);
    if(!tool)throw new Error('Code Agent 已删除，请重新选择');
    const provider=config.providerId?this.d.agents.providers().find((row)=>row.id===config.providerId):undefined;
    const current=agentSourceIdentity(config,tool,provider),previous=this.snapshot(restore.taskId);
    if(current.kind!==restore.runner)throw new Error('只能选择同一个 Code Agent 的智能体恢复');
    const last=this.restoreModel(cwd,restore,previous);
    let sourceChanged=!previous;
    if(previous){try{assertResumeSource(previous.identity,current,false);}catch{sourceChanged=true;}}
    return {previous,current,sourceChanged,model:resumeModel(config,provider,last)};
  }

  async prepare(input: { profileId: string; cwd: string; permission?: AgentPermission; signal: AbortSignal; restore?: AgentRestoreInput }): Promise<PreparedAgentRun | null> {
    const checkCanceled = () => { if(input.signal.aborted)throw new Error('任务启动已取消'); };
    checkCanceled();
    const initial = this.d.agents.configs().find((row) => row.id === input.profileId);
    if (!initial) return null;
    if (initial.source === 'legacy') {
      // Never fork an opaque legacy profile while keeping a normal Agent's
      // persisted account/model/permission record. Unsupported combinations stay
      // stopped with their original history and metadata intact.
      const previous=input.restore?this.snapshot(input.restore.taskId):null;
      if(previous&&previous.identity.source!=='legacy')throw new Error('旧配置包含未识别的运行参数，无法确认原任务的权限与来源；请另选可核验的智能体恢复');
      if(input.restore&&!previous&&!input.restore.explicitlySelected)throw new Error('旧任务尚未记录认证来源，请明确选择智能体后恢复');
      // Pre-M13 legacy history has no recorded permission. Keep its compatibility
      // path without inventing a historical ask/full value. New runs are managed.
      if(input.restore&&!previous)return null;
      return this.prepareLegacy(input,previous);
    }
    await this.d.tools.refresh(); checkCanceled();
    let config = this.d.agents.configs().find((row) => row.id === input.profileId);
    if (!config || config.source === 'legacy') throw new Error('智能体配置已变化，请重新选择');
    const tool = this.d.agents.tools().find((row) => row.id === config!.toolId);
    if (!tool || !tool.installed) throw new Error('没有检测到 Code Agent，请重新检测');
    let provider = config.providerId ? this.d.agents.providers().find((row) => row.id === config!.providerId) : undefined;
    if(config.source==='provider') {
      if (!provider) throw new Error('原供应商已删除，请重新选择智能体');
      provider = await this.d.providers.refreshForLaunch(provider.id,tool.kind as CodeAgentKind,input.signal); checkCanceled();
      config = this.d.agents.configs().find((row) => row.id === input.profileId);
      if (!config || config.providerId !== provider.id) throw new Error('智能体配置已变化，请重新选择');
    }
    const identity = agentSourceIdentity(config,tool,provider), previous = input.restore ? this.snapshot(input.restore.taskId) : null;
    const preference=this.d.permissionPreferences?.()??{selected:'ask' as const,fullConfirmed:false};
    const permission = previous?.permission.id ?? input.permission ?? preference.selected;
    if(!previous&&permission==='full'&&!preference.fullConfirmed)throw new Error('首次使用完全访问权限，请先在界面确认');
    let model: string | null | undefined;
    if(input.restore) {
      if(input.restore.runner!==tool.kind)throw new Error('只能选择同一个 Code Agent 的智能体恢复');
      const confirmed=input.restore.sourceConfirmation?agentSourceIdentitySchema.parse(input.restore.sourceConfirmation):null;
      // Selecting a different config is intentional, but never authorizes a
      // different account from the preview that the caller actually confirmed.
      if(confirmed&&JSON.stringify(confirmed)!==JSON.stringify(identity))throw new Error('所确认的智能体来源已变化，请重新选择后恢复');
      if(previous){
        const sameConfig=previous.identity.configId===identity.configId;
        const explicit=input.restore.explicitlySelected&&(!sameConfig||JSON.stringify(confirmed)===JSON.stringify(identity));
        assertResumeSource(previous.identity,identity,explicit);
      }
      else if(!input.restore.explicitlySelected)throw new Error('旧任务尚未记录认证来源，请明确选择智能体后恢复');
      const last = this.restoreModel(input.cwd,input.restore,previous);
      const decision = resumeModel(config,provider,last);
      if(decision.changed&&(!input.restore.acceptModelChange||input.restore.expectedModel!==decision.model))throw new Error(`${decision.reason}；请确认恢复时的模型`);
      model=decision.model;
    }
    const connection = provider ? this.d.providers.runtimeConnection(provider.id,identity.kind) : undefined;
    const originalProfile=this.d.profiles.get(config.id);
    const advancedEnvironment:Record<string,string>={};
    for(const entry of originalProfile.env)if(!entry.secret&&['MAX_THINKING_TOKENS','CLAUDE_CODE_MAX_OUTPUT_TOKENS','API_TIMEOUT_MS'].includes(entry.name)&&typeof entry.value==='string')advancedEnvironment[entry.name]=entry.value;
    const runId=randomUUID();
    const codexHistory=input.restore?.runner==='codex'&&input.restore.recovery==='resumable'&&config.source==='provider'?input.restore:null;
    const codexFile=codexHistory?.stateRoot&&codexHistory.sessionId?builtinRunnerAdapters.get('codex').sessionFile(codexHistory.stateRoot,input.cwd,codexHistory.sessionId,{sinceMs:codexHistory.since,scan:true}):null;
    const codexResumeProviderId=codexHistory?readCodexProviderId(codexFile,codexHistory.sessionId??''):null;
    if(codexHistory&&!codexResumeProviderId)throw new Error('原生 Codex 会话未记录供应商标识，无法安全恢复');
    const plan = planAgentLaunch({ config,tool,provider,key:connection?.target.key,permission,cwd:input.cwd,nativeArgs:config.source==='login'?originalProfile.args:[],advancedEnvironment,
      userData:realpathSync(this.d.userData),runId,...(model?{model}:{}),...(codexResumeProviderId?{codexResumeProviderId}:{}) });
    materializeAgentPlan(plan,this.d.userData,input.cwd); checkCanceled();
    const base=this.d.baseEnv(),adapter=builtinRunnerAdapters.get(tool.kind);
    const targetRoot=adapter.stateRoot(plan.profile.env,base);
    const skillProjection=this.d.skills?.prepare({runner:tool.kind,home:base.HOME||this.d.userData,stateRoot:targetRoot,cwd:input.cwd,runRoot:join(this.d.userData,'agents/runs',runId),nativeLogin:config.source==='login'});
    if(skillProjection)plan.profile.args.push(...skillProjection.args);
    const mcpProjection=this.d.mcp?.prepare({runner:tool.kind,cwd:input.cwd,runRoot:join(this.d.userData,'agents/runs',runId),injectedNames:Object.keys(plan.profile.env)});
    if(mcpProjection){plan.profile.args.push(...mcpProjection.args);Object.assign(plan.profile.env,mcpProjection.env);}
    let restoreRoot: ClaudeRestoreReceipt | undefined;
    if(input.restore&&tool.kind==='claude'&&input.restore.stateRoot&&input.restore.sessionId&&input.restore.stateRoot!==targetRoot) {
      const original=input.restore;
      if(original.recovery==='resumable'){
        await original.beforeHistoryCopy?.({from:original.stateRoot!,to:targetRoot,cwd:input.cwd,sessionId:original.sessionId!,home:base.HOME||this.d.userData});
        checkCanceled();restoreRoot=copyClaudeSession({from:original.stateRoot!,to:targetRoot,cwd:input.cwd,sessionId:original.sessionId!,nativeTarget:config.source==='login'});
      }
      else {
        const from=original.stateRoot!,sessionId=original.sessionId!;
        const assertCurrent=()=>{if(!adapter.canConfirmNoHistory(from)||adapter.sessionFile(from,input.cwd,sessionId,{sinceMs:original.since,scan:true}))throw new Error('原生空会话状态已变化，请重试');};
        assertCurrent();restoreRoot={from,to:targetRoot,sessionId,assertCurrent};
      }
    }
    const toolIdentity=(value:typeof tool|undefined)=>value?JSON.stringify({id:value.id,kind:value.kind,executable:value.executable,version:value.version,installed:value.installed,login:value.login}):null;
    const configVersion=JSON.stringify(config),toolVersion=toolIdentity(tool);
    const assertCurrent=()=>{
      checkCanceled();connection?.assertCurrent();restoreRoot?.assertCurrent();
      if(codexHistory&&readCodexProviderId(codexFile,codexHistory.sessionId??'')!==codexResumeProviderId)throw new Error('原生会话供应商记录已变化，请重新恢复');
      if(JSON.stringify(this.d.agents.configs().find((row)=>row.id===config!.id))!==configVersion||toolIdentity(this.d.agents.tools().find((row)=>row.id===tool.id))!==toolVersion)throw new Error('智能体或工具在启动前已变化，请重试');
      if(provider&&plan.model&&!this.d.agents.providers().find((row)=>row.id===provider!.id)?.models.some((item)=>item.id===plan.model&&!item.offline&&item.availability[identity.kind]!=='unavailable'))throw new Error('运行模型在启动前已变化，请重新选择');
    };
    assertCurrent();
    plan.profile.secretValues=[...(connection?[connection.target.key]:[]),...(mcpProjection?.secretValues??[])];
    const codexGlobal=identity.kind==='codex'?{path:join(targetRoot,'config.toml'),before:readCodexGlobalSettings(targetRoot),changed:false,dismissed:false}:undefined;
    return {profile:plan.profile,restoreRoot,assertCurrent,
      snapshot:(stateRoot,startedAt)=>({version:1,identity,name:config!.name,toolVersion:tool.version,
        providerName:provider?.name??null,providerPreset:provider?.preset??null,defaultModel:config!.defaultModel,models:[...config!.models],
        permission:plan.permission,permissionSource:previous?(previous.permissionSource??'created'):(input.restore?'unrecorded-history':'created'),model:plan.model,stateRoot,startedAt,...(skillProjection?{managedSkills:{configured:skillProjection.configured,issues:skillProjection.issues}}:{}),...(mcpProjection?{managedMcp:{configured:mcpProjection.configured,issues:mcpProjection.issues}}:{}),...(codexGlobal?{codexGlobal}:{})})};
  }

  private legacyRevision(id:string):string {
    const row=this.d.db.select().from(aiProfiles).where(eq(aiProfiles.id,id)).get();if(!row)throw new Error('旧配置已删除');
    try{
      const args:unknown=JSON.parse(row.args),env:unknown=JSON.parse(row.env);
      if(!Array.isArray(args)||args.some(v=>typeof v!=='string')||!Array.isArray(env)||env.some(v=>!v||typeof v!=='object'||Array.isArray(v)||typeof v.name!=='string'||typeof v.secret!=='boolean'||(v.value!==null&&typeof v.value!=='string')))throw new Error();
    }catch{throw new Error('旧配置的参数或环境数据已损坏，保留原记录，请先检查旧配置');}
    const refs=this.d.db.select().from(appSecrets).all().filter(s=>s.key.startsWith(`ai:${id}:env:`)).sort((a,b)=>a.key.localeCompare(b.key));
    // Ciphertext, not decrypted key material, participates in the renderer-safe
    // identity. Names/order/visibility do not change an authentication source.
    return createHash('sha256').update(JSON.stringify([row.runner,row.executable,row.args,row.env,refs])).digest('hex');
  }

  private async prepareLegacy(input:{profileId:string;cwd:string;permission?:AgentPermission;signal:AbortSignal;restore?:AgentRestoreInput},previous:AgentRunSnapshot|null):Promise<PreparedAgentRun>{
    const check=()=>{if(input.signal.aborted)throw new Error('任务启动已取消');};
    await this.d.tools.refresh();check();
    const config=this.d.agents.configs().find(c=>c.id===input.profileId),tool=this.d.agents.tools().find(t=>t.id===config?.toolId);
    if(!config||config.source!=='legacy'||!tool?.installed)throw new Error('旧配置或 Code Agent 已变化，请重新检测');
    const identity={...agentSourceIdentity(config,tool),legacyRevision:this.legacyRevision(config.id)};
    const pref=this.d.permissionPreferences?.()??{selected:'ask' as const,fullConfirmed:false};
    const permission=previous?.permission.id??input.permission??pref.selected;
    if(!previous&&permission==='full'&&!pref.fullConfirmed)throw new Error('首次使用完全访问权限，请先在界面确认');
    const restore=input.restore;
    if(restore){
      if(restore.runner!==identity.kind)throw new Error('只能选择同一个 Code Agent 的智能体恢复');
      const confirmed=restore.sourceConfirmation?agentSourceIdentitySchema.parse(restore.sourceConfirmation):null;
      if(confirmed&&JSON.stringify(confirmed)!==JSON.stringify(identity))throw new Error('所确认的智能体来源已变化，请重新选择后恢复');
      assertResumeSource(previous!.identity,identity,restore.explicitlySelected&&JSON.stringify(confirmed)===JSON.stringify(identity));
    }
    const profile=this.d.profiles.resolve(config.id),last=restore?this.restoreModel(input.cwd,restore,previous):undefined;
    if(identity.kind==='claude')profile.isolateNames=[...new Set([...(profile.isolateNames??[]),'CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'])];
    const overlay=overlayLegacyPermission(identity.kind,profile.args,permission,last??undefined);
    profile.args=overlay.args;
    const adapter=builtinRunnerAdapters.get(identity.kind),targetRoot=adapter.stateRoot(profile.env,this.d.baseEnv());
    const base=this.d.baseEnv();
    const runRoot=join(this.d.userData,'agents/runs',randomUUID());
    const skillProjection=this.d.skills?.prepare({runner:identity.kind,home:profile.env.HOME||base.HOME||this.d.userData,stateRoot:targetRoot,cwd:input.cwd,runRoot,nativeLogin:true});
    if(skillProjection)profile.args.push(...skillProjection.args);
    const mcpProjection=this.d.mcp?.prepare({runner:identity.kind,cwd:input.cwd,runRoot,injectedNames:Object.keys(profile.env)});
    if(mcpProjection){profile.args.push(...mcpProjection.args);Object.assign(profile.env,mcpProjection.env);profile.secretValues=[...profile.secretValues??[],...mcpProjection.secretValues];}
    if(restore&&identity.kind==='codex'&&restore.stateRoot&&restore.stateRoot!==targetRoot)throw new Error('旧配置的 Codex 会话目录已变化，无法搬移原历史；请保留原目录后恢复');
    let restoreRoot:ClaudeRestoreReceipt|undefined;
    if(restore&&identity.kind==='claude'&&restore.stateRoot&&restore.sessionId&&restore.stateRoot!==targetRoot){
      if(restore.recovery==='resumable'){
        await restore.beforeHistoryCopy?.({from:restore.stateRoot,to:targetRoot,cwd:input.cwd,sessionId:restore.sessionId,home:base.HOME||this.d.userData});
        check();restoreRoot=copyClaudeSession({from:restore.stateRoot,to:targetRoot,cwd:input.cwd,sessionId:restore.sessionId,nativeTarget:true});
      }
      else{
        const from=restore.stateRoot,sessionId=restore.sessionId;
        const assertCurrent=()=>{if(!adapter.canConfirmNoHistory(from)||adapter.sessionFile(from,input.cwd,sessionId,{sinceMs:restore.since,scan:true}))throw new Error('原生空会话状态已变化，请重试');};
        assertCurrent();restoreRoot={from,to:targetRoot,sessionId,assertCurrent};
      }
    }
    const configVersion=JSON.stringify(config),toolVersion=JSON.stringify(tool);
    const assertCurrent=()=>{check();restoreRoot?.assertCurrent();if(this.legacyRevision(config.id)!==identity.legacyRevision||JSON.stringify(this.d.agents.configs().find(c=>c.id===config.id))!==configVersion||JSON.stringify(this.d.agents.tools().find(t=>t.id===tool.id))!==toolVersion)throw new Error('旧配置或工具在启动前已变化，请重试');};
    assertCurrent();
    const codexGlobal=identity.kind==='codex'?{path:join(targetRoot,'config.toml'),before:readCodexGlobalSettings(targetRoot),changed:false,dismissed:false}:undefined;
    return {profile,restoreRoot,assertCurrent,snapshot:(stateRoot,startedAt)=>({version:1,identity,name:config.name,toolVersion:tool.version,providerName:null,providerPreset:null,defaultModel:null,models:[],permission:overlay.permission,permissionSource:previous?.permissionSource??'created',model:overlay.model,stateRoot,startedAt,...(skillProjection?{managedSkills:{configured:skillProjection.configured,issues:skillProjection.issues}}:{}),...(mcpProjection?{managedMcp:{configured:mcpProjection.configured,issues:mcpProjection.issues}}:{}),...(codexGlobal?{codexGlobal}:{})})};
  }

  private restoreModel(cwd:string,restore:Pick<AgentRestoreInput,'runner'|'stateRoot'|'sessionId'|'since'|'recovery'>,previous:AgentRunSnapshot|null):string|null{
    if(restore.recovery!=='resumable')return previous?.model??null;
    const adapter=builtinRunnerAdapters.get(restore.runner);
    const file=restore.stateRoot&&restore.sessionId?adapter.sessionFile(restore.stateRoot,cwd,restore.sessionId,{sinceMs:restore.since,scan:true}):null;
    if(restore.runner!=='codex'&&restore.runner!=='claude')throw new Error('尚未支持的 Code Agent');
    return readRequestedModel(restore.runner,file);
  }
}
