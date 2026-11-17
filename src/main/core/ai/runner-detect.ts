import { execFile } from 'node:child_process';
import type { RunnerInfo } from '@shared/ai-profiles';
import { RUNNERS } from '@shared/ai-profiles';
import type { Runner } from '@shared/types';
import { loginShell } from '../../pty-manager';

// Resolve and version-check in the same login+interactive shell the terminal uses, so the
// answer matches what a task will actually run (Finder-launched apps have a bare PATH).
// Markers separate our output from whatever the rc files print. A PATH-only lookup (not
// `command -v`, which reports aliases) matches the launch, where `exec` skips aliases too.
const DETECT_SCRIPT = [
  'printf "__SMARTDD_SHELL_PATH__%s\\n" "$PATH"',
  'if [ -n "$ZSH_VERSION" ]; then p=$(whence -p -- "$1" 2>/dev/null); else p=$(type -P -- "$1" 2>/dev/null); fi',
  '[ -n "$p" ] || { printf "__SMARTDD_MISSING__\\n"; exit 0; }',
  'case "$p" in /*) ;; *) printf "__SMARTDD_MISSING__\\n"; exit 0;; esac',
  'printf "__SMARTDD_PATH__%s\\n" "$p"',
  '"$p" --version 2>&1 | command head -n 3',
].join('\n');

export interface DetectOptions {
  env: Record<string, string>;
  shell?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Parse the script output; exported for tests. */
export function parseDetectOutput(runner: Runner, command: string, stdout: string): RunnerInfo {
  const lines = stdout.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith('__SMARTDD_PATH__') || l.startsWith('__SMARTDD_MISSING__'));
  if (at === -1 || lines[at].startsWith('__SMARTDD_MISSING__')) {
    return { runner, command, path: null, version: null, error: `找不到 ${command}，请确认已安装，或在配置中手工指定路径` };
  }
  const path = lines[at].slice('__SMARTDD_PATH__'.length).trim();
  const output = lines.slice(at + 1).map(l => l.trim()).filter(Boolean);
  // Native CLIs may print a startup/config warning before --version (notably a fresh CODEX_HOME).
  // Prefer the native version line, keeping unknown output only for the diagnostic path.
  const version = output.find(l => /^(?:codex-cli\s+)?\d+\.\d+\.\d+(?:[-+\w.]*)?(?:\s+\(Claude Code\))?$/.test(l)) ?? output[0];
  return version
    ? { runner, command, path, version, error: null }
    : { runner, command, path, version: null, error: `${command} --version 没有输出` };
}

/** detectRunner plus the login shell's PATH, which every later native step must share with the launch. */
export async function detectNativeCli(runner: Runner, executable: string | null, o: DetectOptions): Promise<RunnerInfo & { shellPath: string | null }> {
  const { info, stdout } = await runDetect(runner, executable, o);
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith('__SMARTDD_SHELL_PATH__'));
  return { ...info, shellPath: line ? line.slice('__SMARTDD_SHELL_PATH__'.length) : null };
}

export async function detectRunner(runner: Runner, executable: string | null, o: DetectOptions): Promise<RunnerInfo> {
  return (await runDetect(runner, executable, o)).info;
}

function runDetect(runner: Runner, executable: string | null, o: DetectOptions): Promise<{ info: RunnerInfo; stdout: string }> {
  const command = executable?.trim() || RUNNERS[runner].command;
  return new Promise((resolve) => {
    execFile(
      o.shell ?? loginShell(),
      ['-l', '-i', '-c', DETECT_SCRIPT, 'smartdd-detect', command],
      { env: o.env, timeout: o.timeoutMs ?? 15_000, maxBuffer: 1024 * 1024, signal: o.signal },
      (err, stdout) => {
        const text = String(stdout ?? ''), info = parseDetectOutput(runner, command, text);
        if (err && !info.path) {
          const timedOut = (err as NodeJS.ErrnoException & { killed?: boolean }).killed;
          resolve({ info: { ...info, error: timedOut ? `检测 ${command} 超时` : (info.error ?? err.message) }, stdout: text });
        } else resolve({ info, stdout: text });
      }
    );
  });
}
