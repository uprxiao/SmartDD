import { join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { agentIdSchema } from '@shared/agent-id';
import { inspectNativeLaunch, type NativeLaunchContext, type TaskLaunchInput } from './native-launch-context';

export interface SkillProjectionContext { home: string; storeRoot: string; taskId: string }
/** Trusted startup composition. Immutable CJS resources implement plan() and
 * entry configuration; the host owns publication, hashes, process identity,
 * authorization and cleanup. Reusable mechanisms preserve each Agent's id. */
export interface CapabilityDeliveryAdapter {
  readonly id: string;
  readonly runnerId: string;
  readonly discovery: 'shared-home' | 'session-plugin';
  skillProjection(context: SkillProjectionContext): string;
  inspectNative(input: TaskLaunchInput): Promise<NativeLaunchContext>;
  entryDelivery(entry: 'mcp' | 'cli'): boolean;
}
export class CapabilityDeliveryAdapterRegistry {
  private readonly adapters: ReadonlyMap<string, CapabilityDeliveryAdapter>;
  private readonly runners: ReadonlyMap<string, CapabilityDeliveryAdapter>;
  constructor(entries: readonly CapabilityDeliveryAdapter[]) {
    const adapters = new Map<string, CapabilityDeliveryAdapter>(), runners = new Map<string, CapabilityDeliveryAdapter>();
    for (const entry of entries) {
      if (!agentIdSchema.safeParse(entry.id).success || !agentIdSchema.safeParse(entry.runnerId).success || adapters.has(entry.id) || runners.has(entry.runnerId) || !['shared-home','session-plugin'].includes(entry.discovery) || ['skillProjection','inspectNative','entryDelivery'].some(key => typeof (entry as any)[key] !== 'function')) throw new Error('能力交付适配器声明无效或重复');
      adapters.set(entry.id, Object.freeze(entry));runners.set(entry.runnerId, entry);
    }
    this.adapters = adapters;this.runners = runners;
  }
  get(id: string): CapabilityDeliveryAdapter { const result = this.adapters.get(id);if (!result) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','当前Agent没有已登记的能力交付实现');return result; }
  forRunner(id: string): CapabilityDeliveryAdapter { const result = this.runners.get(id);if (!result) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','当前运行器没有已登记的能力交付实现');return result; }
  shared(id: string): boolean { return this.get(id).discovery === 'shared-home'; }
  list(): readonly CapabilityDeliveryAdapter[] { return [...this.adapters.values()]; }
}
export const builtinCapabilityDeliveryAdapters = new CapabilityDeliveryAdapterRegistry([
  { id: 'claude-code', runnerId: 'claude', discovery: 'session-plugin', skillProjection: context => join(context.storeRoot,'sessions',context.taskId,'claude/plugin/skills'), inspectNative: inspectNativeLaunch, entryDelivery: entry => entry === 'mcp' },
  { id: 'codex', runnerId: 'codex', discovery: 'shared-home', skillProjection: context => join(context.home,'.agents/skills'), inspectNative: inspectNativeLaunch, entryDelivery: () => true },
]);
