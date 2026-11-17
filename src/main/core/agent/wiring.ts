// M14 统一 Agent 工作区的主进程装配：配置档案解析、本机程序发现、托管文件落盘与事件推送。
import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import { codeAgentKindSchema } from '@shared/ai-agents';
import type { AgentService } from '../ai/agent-service';
import type { ProviderService } from '../ai/provider-service';
import type { ProcessIdentityReader } from '../applications/process-identity';
import { materializeAgentPlan } from '../ai/agent-launch-files';
import { AgentStore, type StoredEvent } from './agent-store';
import { AgentRunService, type LiveListener } from './agent-run-service';
import { AgentTaskService, type LaunchResolver } from './agent-task-service';
import { probeAndRecord } from './discovery';
import { resolveProfileLaunch } from './profile-launch';
import { DRIVERS } from './registry';
import type { DriverId } from './capabilities';
import { DriverError } from './driver';
import { tiersFor } from './permissions';


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
}

export function driverForKind(kind: string): DriverId {
  const k = codeAgentKindSchema.safeParse(kind);
  if (!k.success) throw new DriverError('UNSUPPORTED', `暂不支持的执行器：${kind}`);
  return k.data === 'codex' ? 'codex-app-server' : 'claude-sdk';
}

export function createAgentWorkspace(d: AgentWorkspaceDeps) {
  const store = new AgentStore(d.sqlite);
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
  const resolveLaunch: LaunchResolver = async ({ profileId, cwd, model }) => {
    const c = config(profileId);
    const tool = d.agents.tools().find(t => t.id === c.toolId);
    if (!tool) throw new DriverError('REJECTED', 'Code Agent 已删除，请重新检测');
    const provider = c.providerId ? d.agents.providers().find(p => p.id === c.providerId) : undefined;
    const kind = codeAgentKindSchema.parse(c.kind);
    const connection = provider ? d.providers.runtimeConnection(provider.id, kind) : undefined;
    const base = d.baseEnv();
    const launch = resolveProfileLaunch({ config: c, tool, provider, key: connection?.target.key, cwd, userData: d.userData, runId: randomUUID(), baseEnv: base, model });
    const probe = await probeAndRecord(store, launch.driverId, { env: base, executable: launch.command });
    if (probe.state === 'unsupported' || !probe.realpath || !probe.version) throw new DriverError('UNSUPPORTED', probe.missing ? `${probe.reason}。${probe.missing.hint}` : probe.reason ?? '执行器不可用');
    connection?.assertCurrent();
    materializeAgentPlan(launch.plan, d.userData, cwd);
    const env = probe.shellPath ? { ...launch.env, PATH: probe.shellPath } : launch.env;
    return { driverId: launch.driverId, executable: { path: probe.realpath, version: probe.version }, env, stateRoot: launch.stateRoot, compatibility: launch.compatibility, model: launch.model, extraArgs: launch.extraArgs, settingSources: launch.settingSources };
  };
  const tasks = new AgentTaskService({ store, runs, resolveLaunch, profileDriver: id => driverForKind(config(id).kind), userData: d.userData });
  store.subscribe((e: StoredEvent) => d.emitEvent(e));
  const live: LiveListener = ({ taskId, runId, event }) => { if (event.type === 'message.delta') d.emitLive({ taskId, runId, itemKey: event.nativeItemId, text: event.text }); };
  runs.onLive(live);
  /** 首页与任务页的智能体列表：只列可用于新任务的配置，带执行器与可选档位。 */
  const profiles = () => d.agents.configs().filter(c => c.source !== 'legacy' && codeAgentKindSchema.safeParse(c.kind).success).map(c => {
    const driverId = driverForKind(c.kind);
    return { profileId: c.id, name: c.name, kind: c.kind, driverId, source: c.source, models: c.models, defaultModel: c.defaultModel, available: c.available, isDefault: c.isDefault, tiers: tiersFor(driverId) };
  });
  return { store, runs, tasks, profiles, closeAll: () => runs.closeAll() };
}
export type AgentWorkspace = ReturnType<typeof createAgentWorkspace>;
