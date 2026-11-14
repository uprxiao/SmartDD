import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { codeAgentKindSchema, type CodeAgentTool, type ProviderView, type RunConfigView } from '@shared/ai-agents';
import { agentPermission, type AgentPermission } from '@shared/agent-permissions';
import type { ResolvedProfile } from './ai-profile-service';
import { buildCodexModelCatalog } from './codex-model-catalog';

export const CLAUDE_MODEL_VARIABLES = ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL'] as const;
export const managedClaudeRoot=(userData:string,configId:string)=>join(userData,'agents','claude',createHash('sha256').update(configId).digest('hex').slice(0,32));
export interface AgentLaunchPlan {
  profile: ResolvedProfile;
  permission: ReturnType<typeof agentPermission>;
  model: string | null;
  /** Only this host-owned Claude root is materialized; native-login state is inherited. */
  claudeRoot: string | null;
  files: { path: string; value: unknown }[];
}
export interface AgentLaunchInput {
  config: RunConfigView;
  tool: CodeAgentTool;
  provider?: ProviderView;
  /** Decrypted in main immediately before planning, never returned through RPC. */
  key?: string;
  permission: AgentPermission;
  cwd: string;
  userData: string;
  runId: string;
  /** A checked restore decision, never read back from the current global model. */
  model?: string;
  /** Exact native session identifier to keep resolvable when explicitly changing source. */
  codexResumeProviderId?: string;
  /** Conservatively migrated native CLI options, kept in the original profile. */
  nativeArgs?: string[];
  advancedEnvironment?: Record<string,string>;
}

/** Translate one normal RunConfig into immutable per-run CLI inputs. No global
 * CLI configuration is read or written here; legacy profiles keep their old path.
 */
export function planAgentLaunch(input: AgentLaunchInput): AgentLaunchPlan {
  const { config, tool, provider } = input;
  const kind = codeAgentKindSchema.parse(tool.kind);
  if (config.toolId !== tool.id || config.kind !== kind || !tool.installed) throw new Error('智能体工具已变化或不可用，请重新检测');
  if (config.source === 'legacy') throw new Error('旧配置须使用原高级配置运行入口');
  if (!isAbsolute(input.cwd) || !isAbsolute(input.userData) || !/^[a-f0-9-]{36}$/i.test(input.runId)) throw new Error('运行目录或身份无效');
  const permission = agentPermission(kind, input.permission);
  const profile: ResolvedProfile = { id: config.id, name: config.name, runner: kind, command: tool.executable,
    args: [...permission.args], env: {}, isolatePrefixes: [], isolateNames: [] };
  if (config.source === 'login') {
    if (tool.login === 'none' || config.loggedOut) throw new Error('请先在终端登录该 Code Agent');
    const retained:string[]=[];let originalModel:string|null=null;
    for(let index=0;index<(input.nativeArgs?.length??0);index++){
      const flag=input.nativeArgs![index];
      if(['--no-alt-screen','--no-daemon','--search'].includes(flag)){retained.push(flag);continue;}
      if(['-m','--model','-a','--ask-for-approval','-s','--sandbox','-c','--config'].includes(flag)){
        const value=input.nativeArgs![++index];if(!value||value.startsWith('-'))throw new Error('旧原生登录参数无法可靠保留');
        if(['-s','--sandbox','-a','--ask-for-approval'].includes(flag))continue;
        if(['-m','--model'].includes(flag)){originalModel=value;if(!input.model)retained.push(flag,value);continue;}
        if(!/^model_reasoning_effort\s*=\s*"?(?:minimal|low|medium|high|xhigh)"?$/.test(value))throw new Error('旧原生登录参数无法可靠保留');
        retained.push(flag,value);continue;
      }
      throw new Error('旧原生登录参数无法可靠保留');
    }
    profile.args=[...retained,...profile.args];
    if (input.model) {
      if (!input.model.trim() || input.model.length > 256 || /^[\s-]/.test(input.model) || /[\x00-\x1f\x7f]/.test(input.model)) throw new Error('恢复模型无效');
      profile.args.push(kind === 'claude' ? '--model' : '-m', input.model);
    }
    return { profile, permission, model: input.model ?? originalModel, claudeRoot: null, files: [] };
  }
  if (!provider || config.providerId !== provider.id) throw new Error('原供应商已删除，请重新选择智能体');
  if (!provider.hasKey || !input.key) throw new Error('需要填写 Key');
  const allowedAdvanced=new Set(['MAX_THINKING_TOKENS','CLAUDE_CODE_MAX_OUTPUT_TOKENS','API_TIMEOUT_MS']);
  for(const [name,value]of Object.entries(input.advancedEnvironment??{})){
    if(!allowedAdvanced.has(name))throw new Error('旧高级变量无法安全注入');
    profile.env[name]=value;
  }
  const selected = config.models.map((id) => provider.models.find((model) => model.id === id));
  const allowed = selected.filter((model) => model && !model.offline && model.availability[kind] !== 'unavailable');
  const model = input.model ?? config.defaultModel;
  if (!model || !allowed.some((item) => item?.id === model)) throw new Error('所选模型已下线或不再允许，请选择其他模型');
  const configHash = createHash('sha256').update(config.id).digest('hex').slice(0, 32);
  const runRoot = join(input.userData, 'agents', 'runs', input.runId);
  if (kind === 'codex') {
    if (!provider.endpoints.responses) throw new Error('供应商没有 OpenAI Responses 协议');
    if (input.codexResumeProviderId && !/^[a-zA-Z0-9_-]{1,128}$/.test(input.codexResumeProviderId)) {
      throw new Error('原生会话供应商标识无效');
    }
    // Codex also compares the current provider ID with the saved session ID.
    // Keep that native identifier while binding it to the confirmed current source.
    const providerName = input.codexResumeProviderId ?? `willyou_${configHash}`;
    const catalog = join(runRoot, 'models.json');
    // TOML string escaping is the JSON basic-string subset; no secret in argv/files.
    const definition = `{name=${JSON.stringify(provider.name)},base_url=${JSON.stringify(provider.endpoints.responses)},wire_api="responses",env_key="OPENAI_API_KEY",requires_openai_auth=false}`;
    profile.args.push('-c', `model_provider=${JSON.stringify(providerName)}`, '-c', `model_providers.${providerName}=${definition}`,
      '-c', `model_catalog_json=${JSON.stringify(catalog)}`, '-m', model,
      '--disable', 'plugins', '--disable', 'shell_snapshot', '-c', 'analytics.enabled=false');
    profile.env.OPENAI_API_KEY = input.key;
    profile.isolateNames = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT_ID'];
    return { profile, permission, model, claudeRoot: null,
      files: [{ path: catalog, value: buildCodexModelCatalog(provider.models, allowed.map((item) => item!.id)) }] };
  }
  if (!provider.endpoints.anthropic) throw new Error('供应商没有 Anthropic 协议');
  const claudeRoot = managedClaudeRoot(input.userData,config.id);
  profile.env = { ...profile.env, CLAUDE_CONFIG_DIR: claudeRoot, ANTHROPIC_BASE_URL: provider.endpoints.anthropic,
    [provider.authType === 'api-key' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN']: input.key,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    CLAUDE_CODE_DISABLE_1M_CONTEXT: '1', CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' };
  for (const variable of CLAUDE_MODEL_VARIABLES) profile.env[variable] = model;
  profile.isolatePrefixes = ['ANTHROPIC_'];
  profile.isolateNames = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
  profile.args.push('--setting-sources', 'user', '--add-dir', input.cwd, '--strict-mcp-config', '--model', model);
  return { profile, permission, model, claudeRoot,
    files: [{ path: join(claudeRoot, 'settings.json'), value: { modelPicker: { options: allowed.map((item) => ({ model: item!.id, label: item!.name })), replaceBuiltInOptions: true } } }] };
}
