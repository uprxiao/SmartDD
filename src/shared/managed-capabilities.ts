import type { Runner } from './types';

/** Public metadata only. MCP commands, URLs, headers and values stay in main. */
export interface ManagedCapabilityView {
  id: string;
  kind: 'skill' | 'mcp';
  name: string;
  runner: Runner;
  sourcePath: string;
  sourceScope: 'user' | 'project' | 'plugin' | 'host';
  projectRoot: string | null;
  sourceLabel: string;
  version: string | null;
  managed: boolean;
  enabled: boolean;
  autoApprove: boolean;
  present: boolean;
  status: 'new' | 'managed' | 'conflict' | 'invalid' | 'missing' | 'plugin' | 'host';
  issues: string[];
  loaded: 'unverified';
  /** Static, value-free target diagnostics. This never asserts native loading. */
  targetIssues?:Partial<Record<'claude'|'codex',string>>;
}
export interface CapabilityRegistryView {
  items: ManagedCapabilityView[];
  autoManage: boolean;
  newCount: number;
}
