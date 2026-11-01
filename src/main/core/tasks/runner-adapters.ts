import type { Runner } from '@shared/types';
import { claudeSessionFile, codexRolloutFile } from './native-sessions';

/** Per-runner lifecycle facts the task service needs. Add a runner here instead of branching in the host. */
export interface RunnerAdapter {
  readonly id: Runner;
  /** Env var through which the CLI is told its state directory. */
  readonly stateEnvVar: string;
  /** 'host': we choose the session id (the task id). 'observed': the CLI creates it and we read it back. */
  readonly sessionIdStrategy: 'host' | 'observed';
  /** Locates the session file; `scan` widens the search beyond the expected folder. */
  sessionFile(root: string, cwd: string, sessionId: string, opts: { sinceMs: number; scan: boolean }): string | null;
}

const claude: RunnerAdapter = {
  id: 'claude', stateEnvVar: 'CLAUDE_CONFIG_DIR', sessionIdStrategy: 'host',
  sessionFile: (root, cwd, sessionId, { scan }) => claudeSessionFile(root, cwd, sessionId, scan),
};
const codex: RunnerAdapter = {
  id: 'codex', stateEnvVar: 'CODEX_HOME', sessionIdStrategy: 'observed',
  sessionFile: (root, _cwd, sessionId, { sinceMs, scan }) => codexRolloutFile(root, sessionId, sinceMs, scan),
};
const adapters: Readonly<Record<Runner, RunnerAdapter>> = { claude, codex };
export const runnerAdapter = (runner: Runner): RunnerAdapter => adapters[runner];
