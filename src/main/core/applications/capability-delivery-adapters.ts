import { join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { agentIdSchema } from '@shared/agent-id';
import { inspectNativeLaunch, type NativeLaunchContext, type TaskLaunchInput } from './native-launch-context';
import { inspectCodexCliSandbox, type CodexCliSandboxPlan } from './codex-effective-sandbox';
import {inspectClaudeCliSandbox,type ClaudeCliSandboxPlan} from './claude-effective-sandbox';
export type CliSandboxPlan=CodexCliSandboxPlan|ClaudeCliSandboxPlan;
import type { AgentSkillTarget } from './agent-skill-library';

export interface SkillProjectionContext { home: string; storeRoot: string; taskId: string }
/** Trusted startup composition. Immutable CJS resources implement plan() and
 * entry configuration; the host owns publication, hashes, process identity,
 * authorization and cleanup. Reusable mechanisms preserve each Agent's id. */
export interface CapabilityDeliveryAdapter {
  readonly id: string;
  readonly runnerId: string;
  readonly discovery: 'shared-home' | 'session-plugin';
  /** Explicitly unverified Skill/MCP delivery only. Never enables CLI or native authorization. */
  readonly bestEffortMcp?: boolean;
  /** Measured per Agent version (R1.0 §7): where it reads WillYou skills and whether changes reach a running session. */
  readonly library: { readonly readsSharedAgentSkills: boolean; readonly skillDirectory?: string; readonly resumable: boolean; readonly skillsReloadInSession: boolean; readonly mcpReloadInSession: boolean };
  skillProjection(context: SkillProjectionContext): string;
  inspectNative(input: TaskLaunchInput): Promise<NativeLaunchContext>;
  effectiveSandbox?(input: TaskLaunchInput, native: NativeLaunchContext): Promise<CliSandboxPlan>;
  entryDelivery(entry: 'mcp' | 'cli'): boolean;
}
export class CapabilityDeliveryAdapterRegistry {
  private readonly adapters: ReadonlyMap<string, CapabilityDeliveryAdapter>;
  private readonly runners: ReadonlyMap<string, CapabilityDeliveryAdapter>;
  constructor(entries: readonly CapabilityDeliveryAdapter[]) {
    const adapters = new Map<string, CapabilityDeliveryAdapter>(), runners = new Map<string, CapabilityDeliveryAdapter>();
    for (const entry of entries) {
      if (!agentIdSchema.safeParse(entry.id).success || !agentIdSchema.safeParse(entry.runnerId).success || adapters.has(entry.id) || runners.has(entry.runnerId) || !['shared-home','session-plugin'].includes(entry.discovery) || ['skillProjection','inspectNative','entryDelivery'].some(key => typeof (entry as any)[key] !== 'function')) throw new Error('能力交付适配器声明无效或重复');
      const mcp=entry.entryDelivery('mcp'),cli=entry.entryDelivery('cli');
      if(typeof mcp!=='boolean'||typeof cli!=='boolean'||!mcp&&!cli||cli&&typeof entry.effectiveSandbox!=='function'||entry.bestEffortMcp&&!mcp)throw new Error('能力交付须有已实现的入口；CLI入口必须提供有效沙箱核验');
      const library=entry.library;
      if(!library||typeof library.resumable!=='boolean'||typeof library.skillsReloadInSession!=='boolean'||typeof library.mcpReloadInSession!=='boolean'||(library.readsSharedAgentSkills?library.skillDirectory!==undefined:typeof library.skillDirectory!=='string'||!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(library.skillDirectory)||library.skillDirectory.split('/').includes('..')))throw new Error('Agent须声明已实测的Skill读取方式：读共享目录，或给出HOME内的相对Skill目录');
      adapters.set(entry.id, Object.freeze(entry));runners.set(entry.runnerId, entry);
    }
    this.adapters = adapters;this.runners = runners;
  }
  get(id: string): CapabilityDeliveryAdapter { const result = this.adapters.get(id);if (!result) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','当前Agent没有已登记的能力交付实现');return result; }
  forRunner(id: string): CapabilityDeliveryAdapter { const result = this.runners.get(id);if (!result) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','当前运行器没有已登记的能力交付实现');return result; }
  shared(id: string): boolean { return this.get(id).discovery === 'shared-home'; }
  list(): readonly CapabilityDeliveryAdapter[] { return [...this.adapters.values()]; }
  libraryTargets(): AgentSkillTarget[] { return this.list().map(a => ({ agentId: a.id, readsSharedAgentSkills: a.library.readsSharedAgentSkills, ...(a.library.skillDirectory ? { skillDirectory: a.library.skillDirectory } : {}) })); }
}
export const builtinCapabilityDeliveryAdapters = new CapabilityDeliveryAdapterRegistry([
  { id: 'claude-code', runnerId: 'claude', discovery: 'session-plugin', library: { readsSharedAgentSkills: false, skillDirectory: '.claude/skills', resumable: true, skillsReloadInSession: false, mcpReloadInSession: true }, skillProjection: context => join(context.storeRoot,'sessions',context.taskId,'claude/plugin/skills'), inspectNative: inspectNativeLaunch, effectiveSandbox: inspectClaudeCliSandbox, entryDelivery: () => true },
  { id: 'codex', runnerId: 'codex', discovery: 'shared-home', library: { readsSharedAgentSkills: true, resumable: true, skillsReloadInSession: true, mcpReloadInSession: false }, bestEffortMcp: true, skillProjection: context => join(context.home,'.agents/skills'), inspectNative: inspectNativeLaunch, effectiveSandbox: inspectCodexCliSandbox, entryDelivery: () => true },
]);
