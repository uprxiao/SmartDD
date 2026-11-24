// 配置档案到程序化驱动参数的适配（技术方案 T1.5 §7.2）。复用现有 planAgentLaunch 的来源、凭据与模型裁定，
// 只把面向终端的命令行参数改写成驱动参数：权限参数一律丢弃（档位每轮由驱动显式下发）。
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';
import type { CodeAgentTool, ProviderView, RunConfigView } from '@shared/ai-agents';
import { managedCodexRoot, planAgentLaunch, type AgentLaunchPlan } from '../ai/agent-launch-plan';
import { RUNTIME_ISOLATION } from '../capabilities/capability-service';
import type { DriverId } from './capabilities';
import { antigravityArgs } from './drivers/antigravity-acp';

export interface ProfileLaunch {
  driverId: DriverId;
  /** 执行器命令或用户显式路径，交发现服务解析 realpath 与版本。 */
  command: string;
  env: Record<string, string>;
  stateRoot: string;
  /** 影响原生会话兼容性的冻结输入：来源、供应商、托管配置根、扩展开关。 */
  compatibility: Record<string, unknown>;
  model?: string;
  extraArgs: string[];
  settingSources?: ('user' | 'project' | 'local')[];
  plan: AgentLaunchPlan;
}

export interface ProfileLaunchInput {
  config: RunConfigView;
  tool: CodeAgentTool;
  provider?: ProviderView;
  key?: string;
  cwd: string;
  userData: string;
  runId: string;
  baseEnv: Record<string, string>;
  model?: string;
  /** 订阅登录才有的“沿用我的扩展”开关；托管供应商始终隔离。 */
  carryExtensions?: boolean;
}

/** Codex 全局参数里只保留 -c 与 --disable 两类（成对）；-m 改为模型参数，沙箱与审批参数丢弃。 */
export function codexArgsToDriver(args: readonly string[]): { extraArgs: string[]; model?: string } {
  const extraArgs: string[] = []; let model: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], value = args[i + 1];
    if (flag === '-c' || flag === '--config' || flag === '--disable' || flag === '--enable') {
      if (value === undefined || value.startsWith('-')) throw new Error(`参数 ${flag} 缺少取值`);
      extraArgs.push(flag === '--config' ? '-c' : flag, value); i++; continue;
    }
    if (flag === '-m' || flag === '--model') { if (!value) throw new Error('模型参数缺少取值'); model = value; i++; continue; }
    if (flag === '-s' || flag === '--sandbox' || flag === '-a' || flag === '--ask-for-approval') { i++; continue; }
    if (flag === '--no-alt-screen' || flag === '--search' || flag === '--no-daemon' || flag.startsWith('--dangerously')) continue;
    throw new Error(`无法用于程序化运行的 Codex 参数：${flag}`);
  }
  return { extraArgs, ...(model ? { model } : {}) };
}

function isolatedEnv(base: Record<string, string>, prefixes: readonly string[], names: readonly string[], extra: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (!prefixes.some(p => k.startsWith(p)) && !names.includes(k)) env[k] = v;
  return { ...env, ...extra };
}

export function resolveProfileLaunch(i: ProfileLaunchInput): ProfileLaunch {
  const plan = planAgentLaunch({ config: i.config, tool: i.tool, provider: i.provider, key: i.key, permission: 'ask', cwd: i.cwd, userData: i.userData, runId: i.runId, ...(i.model ? { model: i.model } : {}) });
  const p = plan.profile;
  const env = isolatedEnv(i.baseEnv, [...(p.isolatePrefixes ?? []), ...RUNTIME_ISOLATION], p.isolateNames ?? [], p.env);
  const managed = i.config.source === 'provider';
  const carry = managed ? false : i.carryExtensions !== false;
  // 只保存凭据与端点来源的摘要；换账号／凭据或端点不能恢复旧账号的原生绑定。
  const identity = createHash('sha256').update(JSON.stringify({ key: i.key ?? null, env: Object.fromEntries(Object.entries(p.env).filter(([k]) => /KEY|TOKEN|BASE_URL|ACCOUNT/.test(k))) })).digest('hex');
  if (p.runner === 'antigravity') {
    const stateRoot = join(i.userData, 'agents', 'antigravity', createHash('sha256').update(JSON.stringify([i.config.id, identity])).digest('hex').slice(0, 32));
    plan.antigravityRoot = stateRoot;
    Object.assign(env, {
      HOME: stateRoot, USERPROFILE: stateRoot, XDG_CONFIG_HOME: join(stateRoot, 'config'),
      XDG_DATA_HOME: join(stateRoot, 'data'), XDG_CACHE_HOME: join(stateRoot, 'cache'),
    });
    return {
      driverId: 'antigravity-acp', command: i.tool.customPath || i.tool.executable, env, stateRoot,
      compatibility: { source: i.config.source, providerId: i.config.providerId, identity, extensions: false },
      model: plan.model ?? undefined, extraArgs: antigravityArgs(join(stateRoot, '.gemini')), plan,
    };
  }
  if (p.runner === 'claude') {
    const stateRoot = plan.claudeRoot ?? env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homedir(), '.claude');
    return {
      driverId: 'claude-sdk', command: i.tool.customPath || i.tool.executable, env, stateRoot,
      compatibility: { source: i.config.source, providerId: i.config.providerId, identity, extensions: carry },
      ...(plan.model ? { model: plan.model } : {}),
      extraArgs: [],
      // 托管根本身就是隔离的 user 配置；订阅登录关闭扩展时去掉 user（技术方案 §7.2）。
      settingSources: managed ? ['user'] : carry ? ['user', 'project', 'local'] : ['project', 'local'],
      plan,
    };
  }
  if (p.runner === 'codex') {
    const { extraArgs, model } = codexArgsToDriver(p.args);
    const stateRoot = managed ? managedCodexRoot(i.userData, i.config.id) : env.CODEX_HOME ?? join(env.HOME ?? homedir(), '.codex');
    if (managed) {
      env.CODEX_HOME = stateRoot; p.env.CODEX_HOME = stateRoot; plan.codexRoot = stateRoot;
      // D06-72: Codex also discovers Skills from shared folders under HOME, so a managed run gets a private HOME.
      // The user's Git and SSH configuration still apply (user decision 2026-11-19); OpenSSH reads keys from the account home anyway.
      const userHome = env.HOME ?? homedir();
      env.HOME = join(stateRoot, 'home');
      if (!env.GIT_CONFIG_GLOBAL) {
        const gitConfig = [join(userHome, '.gitconfig'), join(env.XDG_CONFIG_HOME ?? join(userHome, '.config'), 'git', 'config')].find(f => existsSync(f));
        if (gitConfig) env.GIT_CONFIG_GLOBAL = gitConfig;
      }
      const sshConfig = join(userHome, '.ssh', 'config');
      if (!env.GIT_SSH_COMMAND && existsSync(sshConfig)) env.GIT_SSH_COMMAND = `ssh -F ${JSON.stringify(sshConfig)}`;
    }
    if (!carry && !managed) {
      const file = join(stateRoot, 'config.toml');
      if (existsSync(file)) {
        if (statSync(file).size > 1024 * 1024) throw new Error('Codex 用户配置过大，无法核对扩展；请保持沿用或检查配置');
        const config = parseToml(readFileSync(file, 'utf8'));
        const servers = config.mcp_servers;
        if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
          const names = Object.keys(servers);
          if (names.length) extraArgs.push('-c', `mcp_servers={${names.map(name => `${JSON.stringify(name)}={enabled=false}`).join(',')}}`);
        }
      }
    }
    return {
      driverId: 'codex-app-server', command: i.tool.customPath || i.tool.executable, env, stateRoot,
      compatibility: { source: i.config.source, providerId: i.config.providerId, identity, extensions: carry },
      ...(model ?? plan.model ? { model: model ?? plan.model! } : {}),
      extraArgs, plan,
    };
  }
  throw new Error(`暂不支持的执行器：${p.runner}`);
}
