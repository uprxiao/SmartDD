import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { z } from 'zod';
import { aiProfileInputSchema, type RunnerInfo } from '@shared/ai-profiles';
import { buildRunnerArgs, type RunnerArgsOptions } from '@shared/runner-args';
import type { CodexRolloutMeta } from '@shared/codex-session';
import type { Runner } from '@shared/types';
import { detectRunner, type DetectOptions } from '../ai/runner-detect';
import { claudeSessionFile, codexRolloutFile, recentCodexRollouts } from './native-sessions';

export interface RunnerDescription {
  readonly id: string;
  readonly agentId: string;
  readonly label: string;
  readonly sessionLabel: string;
  readonly command: string;
  readonly isolatedEnvPrefixes?: readonly string[];
}
export type RunnerExecutable = Omit<RunnerInfo, 'runner'>;
/** Normalized candidates; native headers and formats are parsed by the adapter. */
export type ObservedRunnerSession = CodexRolloutMeta;

/** Per-runner lifecycle facts the task service needs. Add a runner here instead of branching in the host. */
export interface RunnerAdapter {
  readonly id: string;
  describe(): RunnerDescription;
  profileSchema(): z.ZodType;
  discoverExecutable(executable: string | null, options: DetectOptions): Promise<RunnerExecutable>;
  detectVersion(executable: string, options: DetectOptions): Promise<string | null>;
  /** Env var through which the CLI is told its state directory. */
  readonly stateEnvVar: string;
  /** An implicit Claude default selects different native config from an explicit default. */
  readonly preserveImplicitStateRoot: boolean;
  defaultStateRoot(home: string): string;
  stateRoot(profileEnv: Readonly<Record<string, string>>, baseEnv: Readonly<Record<string, string>>): string;
  launchArgs(options: RunnerArgsOptions): string[];
  /** 'host': we choose the session id (the task id). 'observed': the CLI creates it and we read it back. */
  readonly sessionIdStrategy: 'host' | 'observed';
  observeSessions(root: string, sinceMs: number): Promise<ObservedRunnerSession[]>;
  /** Locates the session file; `scan` widens the search beyond the expected folder. */
  sessionFile(root: string, cwd: string, sessionId: string, opts: { sinceMs: number; scan: boolean }): string | null;
  /** Only a readable original native tree can attest that an owned host-ID run wrote no history. */
  canConfirmNoHistory(root: string): boolean;
}

function nativeProbe(id: Runner) {
  const probe = async (executable: string | null, options: DetectOptions): Promise<RunnerExecutable> => {
    const { runner: _runner, ...value } = await detectRunner(id, executable, options);
    return value;
  };
  return { discoverExecutable: probe, detectVersion: async (executable: string, options: DetectOptions) => (await probe(executable, options)).version };
}

const claude = Object.freeze<RunnerAdapter>({
  id: 'claude', stateEnvVar: 'CLAUDE_CONFIG_DIR', sessionIdStrategy: 'host', preserveImplicitStateRoot: true,
  describe: () => ({ id: 'claude', agentId: 'claude-code', label: 'Claude Code', sessionLabel: 'Claude', command: 'claude', isolatedEnvPrefixes: ['ANTHROPIC_'] }),
  profileSchema: () => aiProfileInputSchema.refine(profile => profile.runner === 'claude'),
  ...nativeProbe('claude'),
  defaultStateRoot: (home: string) => join(home, '.claude'),
  stateRoot: (profileEnv: Readonly<Record<string, string>>, baseEnv: Readonly<Record<string, string>>) => profileEnv.CLAUDE_CONFIG_DIR || baseEnv.CLAUDE_CONFIG_DIR || join(profileEnv.HOME || baseEnv.HOME || homedir(), '.claude'),
  launchArgs: (options: RunnerArgsOptions) => buildRunnerArgs('claude', options),
  observeSessions: async () => [],
  sessionFile: (root, cwd, sessionId, { scan }) => claudeSessionFile(root, cwd, sessionId, scan),
  canConfirmNoHistory: (root: string) => {
    try {
      if (!statSync(root).isDirectory()) return false;
      accessSync(root, constants.R_OK | constants.X_OK);
      const directory = join(root, 'projects');
      let names: string[] = [];
      try { names = readdirSync(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      for (const name of names) { const folder = join(directory, name); if (statSync(folder).isDirectory()) accessSync(folder, constants.R_OK | constants.X_OK); }
      return true;
    } catch { return false; }
  },
});
const codex = Object.freeze<RunnerAdapter>({
  id: 'codex', stateEnvVar: 'CODEX_HOME', sessionIdStrategy: 'observed', preserveImplicitStateRoot: false,
  describe: () => ({ id: 'codex', agentId: 'codex', label: 'Codex', sessionLabel: 'Codex', command: 'codex' }),
  profileSchema: () => aiProfileInputSchema.refine(profile => profile.runner === 'codex'),
  ...nativeProbe('codex'),
  defaultStateRoot: (home: string) => join(home, '.codex'),
  stateRoot: (profileEnv: Readonly<Record<string, string>>, baseEnv: Readonly<Record<string, string>>) => profileEnv.CODEX_HOME || baseEnv.CODEX_HOME || join(profileEnv.HOME || baseEnv.HOME || homedir(), '.codex'),
  launchArgs: (options: RunnerArgsOptions) => buildRunnerArgs('codex', options),
  observeSessions: recentCodexRollouts,
  sessionFile: (root, _cwd, sessionId, { sinceMs, scan }) => codexRolloutFile(root, sessionId, sinceMs, scan),
  canConfirmNoHistory: () => false,
});

/** Host composition is fixed before a TaskService starts; live runs cannot replace adapters. */
export class RunnerAdapterRegistry {
  private readonly adapters: ReadonlyMap<string, RunnerAdapter>;
  constructor(entries: readonly RunnerAdapter[]) {
    const adapters = new Map<string, RunnerAdapter>();
    for (const entry of entries) {
      const methods = ['describe','profileSchema','discoverExecutable','detectVersion','defaultStateRoot','stateRoot','launchArgs','observeSessions','sessionFile','canConfirmNoHistory'] as const;
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(entry.id) || adapters.has(entry.id) || methods.some(key=>typeof entry[key]!=='function') || entry.describe().id !== entry.id || !/^[A-Z][A-Z0-9_]*$/.test(entry.stateEnvVar)) throw new Error('运行器适配器身份无效或重复');
      // Preserve prototype methods on class-based trusted adapters as well as
      // object implementations; spreading an instance silently loses them.
      adapters.set(entry.id, Object.freeze(entry));
    }
    this.adapters = adapters;
  }
  get(id: string): RunnerAdapter { const adapter = this.adapters.get(id); if (!adapter) throw new Error(`运行器适配器未登记：${id}`); return adapter; }
  list(): readonly RunnerAdapter[] { return [...this.adapters.values()]; }
}
export const builtinRunnerAdapters = new RunnerAdapterRegistry([claude, codex]);
export const runnerAdapter = (runner: Runner): RunnerAdapter => builtinRunnerAdapters.get(runner);
