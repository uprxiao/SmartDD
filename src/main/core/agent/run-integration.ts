import type { DriverOpenOptions } from './driver';
/** Host-minted lifecycle closure. No process or scope receipt comes from RPC/MCP arguments. */
export interface RunIntegration {
  extraArgs?: string[]; env?: Record<string, string>; mcpServers?: DriverOpenOptions['mcpServers'];
  skillRoots?: DriverOpenOptions['skillRoots']; plugins?: DriverOpenOptions['plugins'];
  beforeFork(): Promise<void>;
  attached(pid: number): Promise<void>;
  exited(): Promise<void>;
  cancelBeforeFork(): Promise<void>;
  assertCurrent?(): void;
}
