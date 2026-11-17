import type { BridgeTool } from '@shared/application-bridge';
import type { RunContext } from './run-registry';
export interface AgentHostTools {
  list(context: RunContext): BridgeTool[];
  call(context: RunContext, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}
