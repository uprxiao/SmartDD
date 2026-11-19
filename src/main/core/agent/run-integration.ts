import type { DriverOpenOptions } from './driver';
/** Host-minted lifecycle closure. No process or scope receipt comes from RPC/MCP arguments. */
export interface RunIntegrationContext {
  runId: string;
  bindingId: string;
  generation: number;
  nativeId?: string;
  /** Stops during opening invalidate the startup authorization of this exact run. */
  startupCancelled(): boolean;
}

export interface RunIntegration {
  hostBusinessCli?:DriverOpenOptions['hostBusinessCli'];
  codexCliPermissions?:DriverOpenOptions['codexCliPermissions'];
  claudeSettings?:Record<string,unknown>;extraArgs?: string[]; env?: Record<string, string>; mcpServers?: DriverOpenOptions['mcpServers'];
  claudeMcp?: DriverOpenOptions['claudeMcp'];
  skillRoots?: DriverOpenOptions['skillRoots']; plugins?: DriverOpenOptions['plugins'];
  beforeFork(): Promise<void>;
  attached(pid: number): Promise<void>;
  exited(): Promise<void>;
  cancelBeforeFork(): Promise<void>;
  assertCurrent?(): void;
}
