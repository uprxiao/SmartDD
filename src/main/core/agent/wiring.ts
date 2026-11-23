import { realpathSync, statSync } from 'node:fs';
import { applicationRunsForAgent } from './application-runs';
import { attachAgentBrowserRequests } from './business-browser';
import { HostBusinessRequests } from './host-business-requests';
import { MessageLinks } from './message-links';
import type { SourceResolver } from '../files/roots';
import { AgentProjectResources } from './project-resources';
import { TurnDiffs } from './turn-diffs';
// M14 统一 Agent 工作区的主进程装配：配置档案解析、本机程序发现、托管文件落盘与事件推送。
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { withShellProxy } from '../ai/runner-detect';
import type BetterSqlite3 from 'better-sqlite3';
import { codeAgentKindSchema, type CodeAgentTool, type RunConfigView } from '@shared/ai-agents';
import { ApplicationError } from '@shared/applications';
import type { AgentLiveFrame } from '@shared/events';
import type { AgentService } from '../ai/agent-service';
import type { ProviderService } from '../ai/provider-service';
import type { McpProjectionService } from '../capabilities/mcp-projection';
import { MCP_CAPABILITY, type CapabilityService } from '../capabilities/capability-service';
import { discoverCapabilities, type NativeDiscoveryDetails } from '../capabilities/discovery';
import type { ProcessIdentityReader } from '../applications/process-identity';
import { materializeAgentPlan } from '../ai/agent-launch-files';
import { AgentStore, sha256, type StoredEvent } from './agent-store';
import { AgentRunService, type LiveListener } from './agent-run-service';
import { AgentTaskService, boundedEvent, type LaunchResolver } from './agent-task-service';
import { createNativeCliDetector, probeAndRecord, probeDriver } from './discovery';
import { resolveProfileLaunch } from './profile-launch';
import { DRIVERS } from './registry';
import type { DriverId } from './capabilities';
import { DriverError, type DriverOpenOptions } from './driver';
import { previewCodexModels } from './drivers/codex-app-server';
import { SubscriptionCatalogs, subscriptionCatalogScope } from './subscription-catalog';
import type { AgentModelCatalog, AgentModelScope, CatalogReadMode } from '@shared/agent-model-choice';
import { providerModelOptions } from '@shared/agent-model-choice';
import { tiersFor } from './permissions';
import { AgentManualTerminals } from './manual-terminal';
import { canonicalPath } from './identity';
import { homedir } from 'node:os';
import type { ManagedTaskCapabilities } from '../applications/task-capability-launcher';
import { DelegationService } from './delegation-service';
import { runWorkspaceCommand, GitWorkspaces } from './git-workspaces';
import { ownedWorkspaceCommand } from './owned-command';
import { AgentLiveOutput } from './live-output';


export function registeredProjectCwd(sqlite: BetterSqlite3.Database, projectId: string, dirId: string) {
  if (typeof projectId !== 'string' || !projectId || typeof dirId !== 'string' || !dirId) {
    throw new DriverError('REJECTED', '必须选择当前项目已登记的目录');
  }
  const row = sqlite.prepare(`SELECT d.path FROM project_dirs d JOIN projects p ON p.id=d.project_id
    WHERE d.id=? AND p.id=? AND p.archived_at IS NULL`).get(dirId, projectId) as { path: string } | undefined;
  if (!row) throw new DriverError('REJECTED', '目录没有登记在当前活动项目');
  try {
    const cwd = realpathSync(row.path);
    if (statSync(cwd).isDirectory()) return cwd;
  } catch { /* The registered path may have been removed. */ }
  throw new DriverError('REJECTED', '登记的工作目录已不可用');
}

export interface AgentWorkspaceDeps {
  sqlite: BetterSqlite3.Database;
  agents: AgentService;
  providers: ProviderService;
  capabilities: CapabilityService;
  userData: string;
  baseEnv(): Record<string, string>;
  processes: ProcessIdentityReader;
  host: { instanceId: string; pid: number; startedAt: string | null };
  emitEvent(e: StoredEvent): void;
  emitLive(e: AgentLiveFrame): void;
  ptys?: import('./manual-terminal').TerminalPtys;
  mcpProjection?: Pick<McpProjectionService, 'prepare'>;
  skillProjection?: Pick<import('../capabilities/skill-projection').SkillProjectionService, 'prepare'>;
}

export function driverForKind(kind: string): DriverId {
  const k = codeAgentKindSchema.safeParse(kind);
  if (!k.success) throw new DriverError('UNSUPPORTED', `暂不支持的执行器：${kind}`);
  return k.data === 'codex' ? 'codex-app-server' : 'claude-sdk';
}

export function createAgentWorkspace(d: AgentWorkspaceDeps) {
  let business: ManagedTaskCapabilities | undefined;
  // 超限正文转 artifact（技术方案 §3.1，复核 U01），与附件副本同在用户数据目录。
  const store = new AgentStore(d.sqlite, { artifactDir: join(d.userData, 'agent-artifacts') });
  // 上一宿主留下的运行：先收口，再按准确出生身份结束仍在运行的原生进程（取不到身份则不动）。
  for (const r of store.recoverOrphanRuns(d.host.instanceId)) {
    if (r.pid && r.processStartedAt && d.processes.state({ pid: r.pid, startedAt: r.processStartedAt }) === 'running') { try { process.kill(r.pid, 'SIGTERM'); } catch { /* 已退出 */ } }
  }
  const runs = new AgentRunService({ store, drivers: DRIVERS, processes: d.processes, host: d.host });
  const modelCatalogs = new SubscriptionCatalogs(d.sqlite);
  const catalogAccountId = (account: string, path: string, version: string | null) => sha256(JSON.stringify([account, path, version]));
  const recoveryAbort = new AbortController();
  const reconcileRecoveredRun = async (runId: string) => {
    let run = store.run(runId);
    if (run?.state === 'orphaned' && store.sqlite.prepare("SELECT 1 FROM capability_run_processes WHERE run_id=? AND kind='cli'").get(runId)) {
      if (!business) return false;
      await business.recoverAgentRun(runId);
      run = store.run(runId);
      if (run?.state === 'orphaned') return false;
    }
    if (run?.state === 'stopped') store.finishRun(runId, run.task_id, 'stopped', run.error_code);
    return true;
  };
  void runs.recoverPreviousNativeNodes(recoveryAbort.signal, reconcileRecoveredRun).catch(() => {});
  const config = (profileId: string) => {
    const c = d.agents.configs().find(x => x.id === profileId);
    if (!c) throw new DriverError('REJECTED', '智能体已删除，请重新选择');
    if (c.source === 'legacy') throw new DriverError('UNSUPPORTED', '旧配置不能用于新任务，请另选智能体');
    return c;
  };
  const detect = createNativeCliDetector();
  const resolveLaunch: LaunchResolver = async ({ taskId, profileId, cwd, model, carryExtensions }) => {
    const resolveStarted = performance.now();
    if (taskId) await runs.recoverPreviousNativeNodes(recoveryAbort.signal, reconcileRecoveredRun, taskId);
    const recoveryDone = performance.now();
    const c = config(profileId);
    const tool = d.agents.tools().find(t => t.id === c.toolId);
    if (!tool) throw new DriverError('REJECTED', 'Code Agent 已删除，请重新检测');
    const provider = c.providerId ? d.agents.providers().find(p => p.id === c.providerId) : undefined;
    const kind = codeAgentKindSchema.parse(c.kind);
    const connection = provider ? d.providers.runtimeConnection(provider.id, kind) : undefined;
    const base = d.baseEnv();
    const input = { config: c, tool, provider, key: connection?.target.key, cwd, userData: d.userData, runId: randomUUID(), baseEnv: base, model, carryExtensions };
    let launch = resolveProfileLaunch(input);
    const old = taskId ? store.bindingLaunch(taskId, profileId) : undefined;
    const withoutExtensions = (x: Record<string, unknown>) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'extensions'));
    if (old && old.frozen.cwd === canonicalPath(cwd) && old.frozen.stateRoot === canonicalPath(launch.stateRoot) && JSON.stringify(withoutExtensions(old.frozen.compatibility)) === JSON.stringify(withoutExtensions(launch.compatibility))) {
      launch = resolveProfileLaunch({ ...input, carryExtensions: old.frozen.compatibility.extensions !== false });
    }
    const probeStarted = performance.now();
    const probe = await probeAndRecord(store, launch.driverId, { env: base, executable: launch.command, detect, inspectCodexProtocol: launch.driverId === 'codex-app-server' });
    if (taskId) store.tx(emit => emit(taskId, 'run.launch_preflight', {
      driverId: launch.driverId, recoveryMs: Math.round(recoveryDone - resolveStarted),
      configurationMs: Math.round(probeStarted - recoveryDone), probeMs: Math.round(performance.now() - probeStarted),
    }));
    if (probe.state === 'unsupported' || !probe.realpath || !probe.version) throw new DriverError('UNSUPPORTED', probe.missing ? `${probe.reason}。${probe.missing.hint}` : probe.reason ?? '执行器不可用');
    connection?.assertCurrent();
    const expectedConfig = JSON.stringify({ kind: c.kind, source: c.source, providerId: c.providerId, toolId: c.toolId, models: c.models, defaultModel: c.defaultModel });
    const expectedCwd = canonicalPath(cwd), expectedStateRoot = canonicalPath(launch.stateRoot);
    const assertCurrent = () => {
      connection?.assertCurrent();
      if (canonicalPath(cwd) !== expectedCwd || canonicalPath(launch.stateRoot) !== expectedStateRoot) throw new DriverError('REJECTED', '工作目录或配置根的物理身份已变化，请重新选择');
      const current = config(profileId);
      if (JSON.stringify({ kind: current.kind, source: current.source, providerId: current.providerId, toolId: current.toolId, models: current.models, defaultModel: current.defaultModel }) !== expectedConfig) throw new DriverError('REJECTED', '配置已变化，原选择预检失效，请重新选择或发送');
    };
    assertCurrent();
    materializeAgentPlan(launch.plan, d.userData, cwd);
    // D06-79: a Finder/Dock launch gets neither the login-shell PATH nor its proxy variables; give the CLI both.
    const env = withShellProxy(probe.shellPath ? { ...launch.env, PATH: probe.shellPath } : launch.env, probe.shellProxy);
    const modelsWithoutImageInput = kind === 'codex' && provider
      ? new Set(provider.models.filter(model => model.codex && !model.codex.inputModalities.includes('image')).map(model => model.id))
      : undefined;
    const scope = kind === 'codex' && c.source === 'login' ? subscriptionCatalogScope(profileId, launch, tool, cwd) : undefined;
    const bindAccount = (account: string) => catalogAccountId(account, probe.realpath!, probe.version);
    return { driverId: launch.driverId, executable: { path: probe.realpath, version: probe.version }, env, stateRoot: launch.stateRoot, compatibility: launch.compatibility, model: launch.model, extraArgs: launch.extraArgs, settingSources: launch.settingSources, capabilities: probe.capabilities, modelsWithoutImageInput, assertCurrent,
      modelCache: scope && {
        read: account => modelCatalogs.modelsForRun(scope.key, bindAccount(account), () => {
          void readSubscriptionCatalog(c, tool, cwd).catch(() => {});
        }),
        write: (account, models) => modelCatalogs.remember(scope.key, bindAccount(account), models),
      },
      integrate: async context => {
        if (!taskId) return undefined;
        const task = store.task(taskId); if (!task?.project_id) return undefined;
        assertCurrent();
        const projectId = task.project_id;
        const actual = resolveProfileLaunch({ ...input, runId: context.runId, carryExtensions: launch.compatibility.extensions !== false });
        materializeAgentPlan(actual.plan, d.userData, cwd);
        const supportsMcp = probe.capabilities.mcp.state === 'enabled';
        const delivery = supportsMcp ? business?.agentDelivery(kind, probe.version!, true) : undefined;
        if (supportsMcp && business && !delivery) {
          store.addHostItem(taskId,null,'system_notice',{code:'businessCapabilitiesUnverified',detail:'当前执行器版本的业务 Skill／MCP／CLI 交付尚未验证，本轮可继续对话和写代码。'});
        }
        const applicationScope = delivery === 'browser' ? delivery : undefined;
        const role = store.sqlite.prepare('SELECT access FROM agent_delegations WHERE child_task_id=?').get(taskId) as { access: string } | undefined;
        const home = base.HOME ?? homedir();
        const runRoot = join(d.userData, 'agents', 'runs', context.runId);
        const skills = role?.access === 'read' || delivery !== 'verified' ? undefined : d.skillProjection?.prepare({
          runner: kind, home: actual.env.HOME ?? home, stateRoot: actual.stateRoot, cwd, runRoot, nativeLogin: c.source === 'login',
        });
        const skillPlugin = skills?.args[0] === '--plugin-dir' ? skills.args[1] : undefined;
        if (skills?.issues.length) store.addHostItem(taskId, null, 'system_notice', {
          code: 'managedSkillUnavailable', detail: skills.issues.map(issue => issue.reason).join('；'),
        });
        const projected = role?.access === 'read' || delivery !== 'verified' ? undefined : d.mcpProjection?.prepare({
          runner: actual.plan.profile.runner, cwd, runRoot,
          injectedNames: Object.keys(actual.plan.profile.env), requireKnownFields: true,
        });
        if (projected?.issues.length) store.addHostItem(taskId, null, 'system_notice', {
          code: 'managedMcpUnavailable', detail: projected.issues.map(issue => issue.reason).join('；'),
        });
        const assertRunCurrent = () => {
          if (context.startupCancelled()) throw new ApplicationError('SCOPE_DENIED', '启动已停止');
          assertCurrent();
        };
        const { runId, bindingId, generation, nativeId } = context;
        const managedCodexHome = actual.plan.codexRoot && actual.env.HOME === join(actual.stateRoot, 'home') ? actual.env.HOME : undefined;
        const profile = { ...actual.plan.profile, command: probe.realpath! };
        let mcpName: string | null = null;
        const contextUnavailable = (detail: string) => store.addHostItem(taskId, null, 'system_notice', {
          severity: 'warning', code: 'projectContextMcpUnavailable', title: '项目上下文 MCP 不可用', detail,
        });
        // Read-only delegated work cannot gain shell access to DB or SSH credentials.
        const projectResourcesAllowed = role?.access !== 'read';
        if (projectResourcesAllowed && d.capabilities.enabled(projectId, MCP_CAPABILITY)) {
          if (!supportsMcp) {
            contextUnavailable('当前执行器未提供 MCP 通道，可使用已启用的数据库和 SSH 诊断 Skill。');
          } else {
            const candidate = 'smartdd_project_' + sha256(taskId).slice(0, 12);
            const details: NativeDiscoveryDetails = { userSkillConfig: [], plugins: [], issues: [] };
            const inventory = discoverCapabilities({
              runner: kind, cwd, home, stateRoot: actual.stateRoot, claudeConfigExplicit: true,
              path: env.PATH ?? '', args: profile.args, details, nativeVersion: probe.version!,
            });
            if (projected?.serverNames.includes(candidate) || inventory.some(item => item.kind === 'mcp' && item.name === candidate)) {
              contextUnavailable('用户 MCP 已使用项目上下文名称。数据库和 SSH 诊断仍可使用。');
            } else if (details.issues.length || inventory.length >= 2000) {
              contextUnavailable('未能核验 MCP 配置。数据库和 SSH 诊断仍可使用。');
            } else {
              mcpName = candidate;
            }
          }
        }
        const runtime = projectResourcesAllowed ? d.capabilities.runtimeIdentity() : undefined;
        const projectRuntime = runtime && d.capabilities.prepare({
          projectId, taskId, runner: kind, cwd, home, profileArgs: profile.args,
          managed: { runId, runtimeHash: runtime.hash, mcpName },
        });
        const serverName = projectRuntime?.snapshot.mcp[0]?.name;
        const projectContextMcp: DriverOpenOptions['projectContextMcp'] = serverName && runtime && projectRuntime ? {
          name: serverName, command: 'python3',
          args: [join(runtime.path, 'context_mcp.py'), projectRuntime.env.SMARTDD_PROJECT_CONTEXT],
        } : undefined;
        try {
          if (!delivery) business?.syncSkillLibrary(kind === 'claude' ? actual.stateRoot : undefined, managedCodexHome);
          const result = delivery && business ? await business.prepareAgent({
            runId, bindingId, generation, checkedCli: probe.checkedCli, version: probe.version!, applicationScope,
            managedCodexHome, assertCurrent: assertRunCurrent,
            projectContext: projectContextMcp && runtime ? { serverName: projectContextMcp.name, runtimeHash: runtime.hash } : undefined,
            task: { projectId, taskId, profile, cwd, home, stateRoot: actual.stateRoot, claudeConfigExplicit: true,
              mode: nativeId ? 'resume' : 'new', sessionId: nativeId ?? null, previous: null, newTask: !nativeId,
              signal: new AbortController().signal, environment: { ...actual.env, ...(probe.shellPath ? { PATH: probe.shellPath } : {}) } },
          }) : undefined;
          if (result && projected?.serverNames.some(name => Object.hasOwn(result.mcpServers ?? {}, name))) {
            await result.cancelBeforeFork();
            throw new DriverError('REJECTED', '已纳管的 MCP 与 WillYou 宿主服务重名，请调整名称');
          }
          if (!result && !projectRuntime) return undefined;
          return {
            ...result, projectRuntime, projectContextMcp,
            env: { ...actual.env, ...result?.env, ...projected?.env, ...projectRuntime?.env },
            extraArgs: [...actual.extraArgs, ...(result?.extraArgs ?? []), ...(kind === 'codex' ? projected?.args ?? [] : [])],
            claudeMcp: projected?.claude,
            plugins: skillPlugin ? [...(result?.plugins ?? []), { type: 'local' as const, path: skillPlugin }] : result?.plugins,
          };
        } catch (error) {
          projectRuntime?.release();
          throw error;
        }
      },
    };
  };
  const tasks = new AgentTaskService({
    store, runs, resolveLaunch, profileDriver: id => driverForKind(config(id).kind),
    profileName: id => d.agents.configs().find(c => c.id === id)?.name ?? '已删除的配置',
    profileModelSettings: id => {
      const profile = d.agents.configs().find(c => c.id === id);
      if (!profile) return { options: [] };
      const provider = profile.providerId ? d.agents.providers().find(p => p.id === profile.providerId) : undefined;
      return { defaultModel: profile.defaultModel, providerBacked: profile.source === 'provider', options: providerModelOptions(provider, profile) };
    },
    userData: d.userData,
  });
  const ownedCommand = ownedWorkspaceCommand({processes:d.processes,env:d.baseEnv,blocked:(options,_proof,detail)=>{if(options.taskId)store.addHostItem(options.taskId,null,'system_notice',{code:'host_job_drain_unknown',detail});}});
  const git = new GitWorkspaces({ store, command:(cwd,command,args,timeout,options)=>options?ownedCommand(cwd,command,args,timeout,options):runWorkspaceCommand(cwd,command,args,timeout), home: d.baseEnv().HOME ?? homedir(), recoverySafe: async taskId => {
    const rows = store.sqlite.prepare('SELECT run_id,state,pid FROM capability_runs WHERE task_id=?').all(taskId) as { run_id: string; state: string; pid: number | null }[];
    for (const r of rows) {
      if (!['stopped', 'failed'].includes(r.state) || r.pid && !await runs.drainNativeGroup(r.run_id)) return false;
      if (store.sqlite.prepare("SELECT 1 FROM capability_run_processes WHERE run_id=? AND state NOT IN ('exited','canceled')").get(r.run_id) || store.sqlite.prepare("SELECT 1 FROM capability_run_activities WHERE run_id=? AND state='active'").get(r.run_id)) return false;
    }
    return true;
  } });
  const delegationProfile = (id: string) => { const c = config(id), provider = c.providerId ? d.agents.providers().find(p => p.id === c.providerId) : undefined; return { profileId: id, driverId: driverForKind(c.kind), name: c.name, models: c.models, available: c.available, trustedRead: c.kind === 'codex' && c.source === 'provider', revision: sha256(JSON.stringify({ config: c, providerRevision: provider?.identityRevision })) }; };
  const delegations = new DelegationService({ store, runs, tasks, git, profile: delegationProfile, profiles: () => d.agents.configs().filter(c => c.source !== 'legacy' && c.available).map(c => delegationProfile(c.id)),
    roots: taskId => { const w = git.workspace(taskId); if (w?.state === 'ready') return [w.path]; const roots = (store.sqlite.prepare('SELECT path FROM project_dirs').all() as { path: string }[]).map(r => r.path); const task = store.task(taskId); return task?.project_id ? roots : task ? [task.cwd] : []; },
    project: id => id ? (store.sqlite.prepare('SELECT id,name FROM projects WHERE id=?').get(id) as { id: string; name: string } | undefined) ?? { id, name: 'project' } : { id: 'unscoped', name: 'project' },
    drained: async runId => { if (!await runs.drainNativeGroup(runId)) return false; if (store.run(runId)?.state === 'orphaned') await business?.recoverAgentRun(runId); const processes = store.sqlite.prepare("SELECT 1 FROM capability_run_processes WHERE run_id=? AND state NOT IN ('exited','canceled')").get(runId); const activities = store.sqlite.prepare("SELECT 1 FROM capability_run_activities WHERE run_id=? AND state='active'").get(runId); return !processes && !activities; },
  });
  const requests = new HostBusinessRequests({store,run:taskId=>runs.runForTask(taskId),hasOwner:taskId=>!!runs.runForTask(taskId)||!!runs.closingForTask(taskId),notify:(taskId,id,text,wake)=>tasks.enqueueHost(taskId,id,text,'notification',wake),acquire:(taskId,_operation,signal)=>delegations.acquireBusiness(taskId,signal)});tasks.attachBusiness(requests);
  const diffs=new TurnDiffs({store,storage:join(d.userData,'agent-diffs'),excluded:(taskId,cwd)=>git.snapshotExclusions(taskId,cwd,d.userData),stable:(taskId,turnId)=>{const run=runs.runForTask(taskId);return !delegations.businessBusy(taskId)&&(!run||!runs.busy(run.runId)&&!runs.nativeBusy(run.runId))&&!store.sqlite.prepare("SELECT 1 FROM agent_turns WHERE task_id=? AND turn_id<>? AND status IN ('dispatching','started')").get(taskId,turnId);},changed:taskId=>store.tx(emit=>emit(taskId,'diff.changed',{}))});
  tasks.attachDiffs(diffs, taskId => delegations.businessBusy(taskId));
  let links:MessageLinks|undefined;
  void git.recoverIntents().catch(() => { /* explicit needs_review records retain ownership */ });
  store.subscribe((e: StoredEvent) => d.emitEvent(boundedEvent(e)));
  const liveOutput = new AgentLiveOutput(d.emitLive);
  const live: LiveListener = ({ taskId, runId, event }) => {
    if (event.type === 'message.delta') liveOutput.append({ taskId, runId, itemKey: event.nativeItemId, text: event.text });
    if (event.type === 'turn.completed' || event.type === 'exit') liveOutput.end(runId);
  };
  const unsubscribeLive = runs.onLive(live);
  const isCodexSubscription = (profile: ReturnType<typeof config>) => profile.kind === 'codex' && profile.source === 'login'
    && d.agents.tools().some(tool => tool.id === profile.toolId && tool.login === 'subscription');
  /** 首页与任务页的智能体列表：只列可用于新任务的配置，带执行器与可选档位。 */
  const profiles = () => d.agents.configs().filter(c => c.source !== 'legacy' && codeAgentKindSchema.safeParse(c.kind).success).map(c => {
    const driverId = driverForKind(c.kind);
    const provider = c.providerId ? d.agents.providers().find(p => p.id === c.providerId) : undefined;
    return { profileId: c.id, name: c.name, kind: c.kind, driverId, source: c.source, models: c.models, defaultModel: c.defaultModel, available: c.available, isDefault: c.isDefault, codexSubscription: isCodexSubscription(c), tiers: tiersFor(driverId), extensionSupport: driverId === 'codex-app-server' ? 'partial' as const : 'full' as const,
      provider: provider ? { name: provider.name, catalog: provider.preset } : undefined, modelOptions: providerModelOptions(provider, c),
    };
  });
  const readSubscriptionCatalog = async (profile: RunConfigView, tool: CodeAgentTool, cwd: string, mode?: CatalogReadMode) => {
    const baseEnv = d.baseEnv();
    const launch = resolveProfileLaunch({ config: profile, tool, cwd, userData: d.userData, runId: randomUUID(), baseEnv });
    const { key, localLoginBound } = subscriptionCatalogScope(profile.id, launch, tool, cwd);
    return modelCatalogs.read(key, async observer => {
      const info = await probeDriver('codex-app-server', { env: baseEnv, executable: launch.command, detect });
      if (!info.realpath || info.state === 'unsupported') throw new DriverError('UNSUPPORTED', info.reason ?? '执行器不可用');
      const env = withShellProxy(info.shellPath ? { ...launch.env, PATH: info.shellPath } : launch.env, info.shellProxy);
      return previewCodexModels(info.realpath, cwd, env, launch.extraArgs, {
        ...observer, account: id => observer.account?.(id && catalogAccountId(id, info.realpath!, info.version)),
      }, recoveryAbort.signal);
    }, mode, localLoginBound);
  };
  d.agents.onSubscriptionDetected = (profile, tool) => {
    if (!recoveryAbort.signal.aborted) void readSubscriptionCatalog(profile, tool, d.baseEnv().HOME ?? homedir()).catch(() => {});
  };
  const modelCatalog = async (scope: AgentModelScope, profileId: string, mode?: CatalogReadMode): Promise<AgentModelCatalog> => {
    const profile = config(profileId);
    if (profile.kind !== 'codex' || profile.source !== 'login') return { status: 'ready', models: [] };
    if (profile.loggedOut || !profile.available) return { status: 'unavailable', models: [] };
    const task = scope.kind === 'task' ? store.task(scope.taskId) : undefined;
    if (scope.kind !== 'project' && (!task || task.archived_at)) throw new DriverError('REJECTED', '任务目录不可用');
    const cwd = scope.kind === 'project' ? registeredProjectCwd(d.sqlite, scope.projectId, scope.dirId) : canonicalPath(task!.cwd);
    const tool = d.agents.tools().find(item => item.id === profile.toolId);
    if (!tool) throw new DriverError('REJECTED', '执行器不可用');
    return readSubscriptionCatalog(profile, tool, cwd, mode);
  };
  const terminals = d.ptys ? new AgentManualTerminals({ ptys: d.ptys, baseEnv: d.baseEnv, taskProject: taskId => store.task(taskId)?.project_id ?? null, taskCwd: id => { tasks.assertWritable(id); const t = store.task(id); if (!t || t.archived_at) throw new DriverError('REJECTED', '任务不存在或已归档'); return t.cwd; } }) : undefined;
  const projectResources = new AgentProjectResources({ store, tasks, diffs, terminals, userData: d.userData });
  tasks.attachAttachmentCleanup((taskId,data)=>projectResources.discardAttachments(taskId,data));
  return { store, runs, tasks, profiles, terminals, isCodexSubscription: (profileId: string) => isCodexSubscription(config(profileId)), modelCatalog, applicationRuns: applicationRunsForAgent(store,runs,tasks,d.processes,d.host.instanceId), git, delegations, requests, diffs, projectResources, projectCwd: (projectId: string, dirId: string) => { projectResources.assertProjectWritable(projectId); return registeredProjectCwd(d.sqlite, projectId, dirId); },applicationReference:(sender:import('../applications/execution-context').ApplicationUiSender,taskId:string,source:import('@shared/application-terminal').ApplicationTerminalSource)=>{if(!business)throw new Error('业务服务不可用');return business.agentReference(sender,taskId,source);},plugins:(taskId:string)=>{if(!store.task(taskId))throw new Error('任务不存在');return business?.taskPlugins(taskId)??[];}, openHomeTerminal:(projectId:string,dirId:string,size?:{cols:number;rows:number})=>{if(!terminals)throw new Error('终端不可用');const cwd=registeredProjectCwd(d.sqlite,projectId,dirId),terminalKey='home-shell-'+sha256(projectId+dirId+cwd).slice(0,32);return{...terminals.openAt(terminalKey,cwd,size,projectId),terminalKey};}, get links(){return links;}, attachBrowser:(browser:import('../browser/service').BrowserService)=>attachAgentBrowserRequests({store,requests,browser,context:runId=>{if(!business)throw new Error('应用运行通道不可用');return business.agentContext(runId);},enabled:taskId=>{if(!business)throw new Error('应用通道不可用');business.assertAgentApplication(taskId,'browser');}}), attachFiles:(sources:SourceResolver)=>{links=new MessageLinks(store,sources,d.baseEnv().HOME??homedir());}, attachBusiness: (value: ManagedTaskCapabilities) => { business = value;tasks.attachHumanRecorder((runId,sender,text,sequence)=>value.recordAgentHumanInput(runId,sender,text,sequence)); value.attachAgentTools(delegations);value.attachAgentRequests(store,requests,(taskId,id,text)=>tasks.enqueueHost(taskId,id,text,'notification',true)); }, closeAll: async () => { recoveryAbort.abort(); await tasks.closePrewarms(); await runs.waitForPreviousRecoveries(); unsubscribeLive(); liveOutput.close(); await requests.close(); await delegations.close(); terminals?.closeAll(); await runs.closeAll(); await projectResources.close(); await diffs.close(); } };
}
export type AgentWorkspace = ReturnType<typeof createAgentWorkspace>;
