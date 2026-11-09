import type { CapabilitySessionPointer } from './application-session';
import type { Runner } from './types';

export interface SkillVersion {
  id: string;
  skillId: string;
  name: string;
  version: string;
  hash: string;
  installedAt: number;
  active: boolean;
}

export interface StandardSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  enabled: boolean;
  current: SkillVersion;
  availableVersion: string;
  updateAvailable: boolean;
  versions: SkillVersion[];
}

/** Static discovery never implies that a model/runner loaded the capability. No raw configs here. */
export interface DiscoveredCapability {
  id: string;
  kind: 'skill' | 'mcp';
  name: string;
  runner: Runner;
  source: string;
  path: string;
  version: string | null;
  enabled: boolean | null;
  validity: 'valid' | 'partial' | 'invalid';
  issues: string[];
  loaded: 'unverified';
  envNames: string[];
}

export interface RuntimeSkill {
  skillId: string;
  name: string;
  versionId: string;
  version: string;
  hash: string;
  path: string;
  enabled: boolean;
  loaded: 'unverified';
}

/** Persisted task metadata. Secret values and arbitrary CLI/server output must never enter it. */
export interface RuntimeSnapshot {
  sessionCapabilities?: CapabilitySessionPointer;
  runId: string;
  projectId: string;
  configVersion: number;
  configHash: string;
  manifestPath: string;
  auditPath: string;
  skills: RuntimeSkill[];
  mcp: { name: string; loaded: 'unverified' }[];
  selfCheck: { status: 'pending' | 'passed' | 'failed'; issues: string[]; at: number | null };
}

export interface CapabilityPreview {
  skills: StandardSkill[];
  mcpEnabled: boolean;
  discovered: DiscoveredCapability[];
  issues: string[];
}
