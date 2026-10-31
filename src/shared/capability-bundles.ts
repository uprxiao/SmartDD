import { z } from 'zod';
import { isPackagePath } from './applications';
const hash = z.string().regex(/^[a-f0-9]{64}$/),path = z.string().refine(isPackagePath),id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),version = z.string().regex(/^\d+\.\d+\.\d+$/);
export const capabilityBundleIndexSchema = z.object({ schema: z.literal('willyou-capability-bundles-v1'),build: z.object({ appVersion: version,commit: z.string().regex(/^[a-f0-9]{40}$/).nullable(),dirty: z.boolean(),resourceSetHash: hash }).strict(),adapters: z.array(z.object({ agentId: z.enum(['claude-code','codex']),version,hash,path }).strict()).max(32),runtimes: z.array(z.object({ id,protocolMajor: z.number().int().positive(),hash,path,bridgeEntry: path }).strict()).max(32),apps: z.array(z.object({ appId: id,version,hash,path }).strict()).max(128),indexHash: hash }).strict();
export type CapabilityBundleIndex = z.infer<typeof capabilityBundleIndexSchema>;
export interface AgentSupportState {
  state: 'preparing' | 'ready' | 'partial' | 'unavailable';errorCode: string | null;legacyResourceCount: number;runtimeHash: string | null;
  applications: { appId: 'zentao' | 'mail';version: string;hash: string;filesReady: boolean;defaultForNewSessions: boolean;errorCode: string | null }[];
  adapters: { agentId: 'claude-code' | 'codex';version: string;hash: string;cliVersions: string[];filesReady: boolean;nativeDiscovery: 'unverified';bridgeRecovery: 'supported'|'unsupported'|'unverified';configReload?:'supported'|'unsupported'|'unverified';recoveryRequiresAgentRestart?:boolean|null;recoveryEvidence?:{cliVersion:string;baseline:string}[] }[];
}
