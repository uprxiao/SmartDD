// M14 统一 Agent 工作区的主进程装配：配置档案解析、本机程序发现、托管文件落盘与事件推送。
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { codeAgentKindSchema } from '@shared/ai-agents';
import type { AgentService } from '../ai/agent-service';
import type { ProviderService } from '../ai/provider-service';
import type { ProcessIdentityReader } from '../applications/process-identity';
import { materializeAgentPlan } from '../ai/agent-launch-files';
import { AgentStore, type StoredEvent } from './agent-store';
import { AgentRunService, type LiveListener } from './agent-run-service';
import { AgentTaskService, boundedEvent, type LaunchResolver } from './agent-task-service';
import { probeAndRecord } from './discovery';
import { resolveProfileLaunch } from './profile-launch';
import { DRIVERS } from './registry';
import type { DriverId } from './capabilities';
import { DriverError } from './driver';
import { tiersFor } from './permissions';
import { AgentManualTerminals } from './manual-terminal';
import { canonicalPath } from './identity';


export interface AgentWorkspaceDeps {
  sqlite: BetterSqlite3.Database;
  agents: AgentService;
  providers: ProviderService;
  userData: string;
  baseEnv(): Record<string, string>;
  processes: ProcessIdentityReader;
  host: { instanceId: string; pid: number; startedAt: string | null };
  emitEvent(e: StoredEvent): void;
  emitLive(e: { taskId: string; runId: string; itemKey: string; text: string }): void;
  ptys?: import('./manual-terminal').TerminalPtys;
}

export function driverForKind(kind: string): DriverId {
  const k = codeAgentKindSchema.safeParse(kind);
  if (!k.success) throw new DriverError('UNSUPPORTED', `暂不支持的执行器：${kind}`);
  return k.data === 'codex' ? 'codex-app-server' : 'claude-sdk';
}

export function createAgentWorkspace(d: AgentWorkspaceDeps) {
  // 超限正文转 artifact（技术方案 §3.1，复核 U01），与附件副本同在用户数据目录。
  const store = new AgentStore(d.sqlite, { artifactDir: join(d.userData, 'agent-artifacts') });
  // 上一宿主留下的运行：先收口，再按准确出生身份结束仍在运行的原生进程（取不到身份则不动）。
  for (const r of store.recoverOrphanRuns(d.host.instanceId)) {
    if (r.pid && r.processStartedAt && d.processes.state({ pid: r.pid, startedAt: r.processStartedAt }) === 'running') { try { process.kill(r.pid, 'SIGTERM'); } catch { /* 已退出 */ } }
  }
  const runs = new AgentRunService({ store, drivers: DRIVERS, processes: d.processes, host: d.host });
  const config = (profileId: string) => {
    const c = d.agents.configs().find(x => x.id === profileId);
    if (!c) throw new DriverError('REJECTED', '智能体已删除，请重新选择');
    if (c.source === 'legacy') throw new DriverError('UNSUPPORTED', '旧配置不能用于新任务，请另选智能体');
    return c;
  };
  const resolveLaunch: LaunchResolver = async ({ taskId, profileId, cwd, model, carryExtensions }) => {
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
    const probe = await probeAndRecord(store, launch.driverId, { env: base, executable: launch.command });
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
    const env = probe.shellPath ? { ...launch.env, PATH: probe.shellPath } : launch.env;
    return { driverId: launch.driverId, executable: { path: probe.realpath, version: probe.version }, env, stateRoot: launch.stateRoot, compatibility: launch.compatibility, model: launch.model, extraArgs: launch.extraArgs, settingSources: launch.settingSources, capabilities: probe.capabilities, assertCurrent };
  };
  const tasks = new AgentTaskService({ store, runs, resolveLaunch, profileDriver: id => driverForKind(config(id).kind), profileName: id => d.agents.configs().find(c => c.id === id)?.name ?? '已删除的配置', userData: d.userData });
  store.subscribe((e: StoredEvent) => d.emitEvent(boundedEvent(e)));
  const live: LiveListener = ({ taskId, runId, event }) => { if (event.type === 'message.delta') d.emitLive({ taskId, runId, itemKey: event.nativeItemId, text: event.text }); };
  runs.onLive(live);
  /** 首页与任务页的智能体列表：只列可用于新任务的配置，带执行器与可选档位。 */
  const profiles = () => d.agents.configs().filter(c => c.source !== 'legacy' && codeAgentKindSchema.safeParse(c.kind).success).map(c => {
    const driverId = driverForKind(c.kind);
    return { profileId: c.id, name: c.name, kind: c.kind, driverId, source: c.source, models: c.models, defaultModel: c.defaultModel, available: c.available, isDefault: c.isDefault, tiers: tiersFor(driverId), extensionSupport: driverId === 'codex-app-server' ? 'partial' as const : 'full' as const };
  });
  const terminals = d.ptys ? new AgentManualTerminals({ ptys: d.ptys, baseEnv: d.baseEnv, taskCwd: id => { const t = store.task(id); if (!t || t.archived_at) throw new DriverError('REJECTED', '任务不存在或已归档'); return t.cwd; } }) : undefined;
  return { store, runs, tasks, profiles, terminals, closeAll: async () => { terminals?.closeAll(); await runs.closeAll(); } };
}
export type AgentWorkspace = ReturnType<typeof createAgentWorkspace>;
