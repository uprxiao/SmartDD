import { execFile } from 'node:child_process';
import type { RunnerInfo } from '@shared/ai-profiles';
import { RUNNERS } from '@shared/ai-profiles';
import type { Runner } from '@shared/types';
import { loginShell } from '../../pty-manager';

// Resolve and version-check in the same login+interactive shell the terminal uses, so the
// answer matches what a task will actually run (Finder-launched apps have a bare PATH).
// Markers separate our output from whatever the rc files print. A PATH-only lookup (not
// `command -v`, which reports aliases) matches the launch, where `exec` skips aliases too.
/** Proxy variables a login shell may set; a Finder/Dock launch does not inherit them (D06-79). */
export const SHELL_PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'] as const;
const DETECT_SCRIPT = [
  'printf "__SMARTDD_SHELL_PATH__%s\\n" "$PATH"',
  ...SHELL_PROXY_VARS.map(name => `[ -n "\${${name}+x}" ] && printf "__SMARTDD_SHELL_ENV__${name}=%s\\n" "\$${name}"`),
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
export async function detectNativeCli(runner: Runner, executable: string | null, o: DetectOptions): Promise<RunnerInfo & { shellPath: string | null; shellProxy: Record<string, string> }> {
  const { info, stdout } = await runDetect(runner, executable, o);
  const lines = stdout.split(/\r?\n/);
  const line = lines.find((l) => l.startsWith('__SMARTDD_SHELL_PATH__'));
  return { ...info, shellPath: line ? line.slice('__SMARTDD_SHELL_PATH__'.length) : null, shellProxy: parseShellProxy(lines) };
}

export function parseShellProxy(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines) {
    if (!l.startsWith('__SMARTDD_SHELL_ENV__')) continue;
    const pair = l.slice('__SMARTDD_SHELL_ENV__'.length), i = pair.indexOf('=');
    const name = pair.slice(0, i);
    if ((SHELL_PROXY_VARS as readonly string[]).includes(name)) out[name] = pair.slice(i + 1);
  }
  return out;
}

/** Fill only the proxy variables the App itself did not get (a terminal launch already carries them). */
export function withShellProxy(env: Record<string, string>, shellProxy: Record<string, string> | null | undefined): Record<string, string> {
  if (!shellProxy) return env;
  const next = { ...env };
  for (const [name, value] of Object.entries(shellProxy)) if (next[name] === undefined) next[name] = value;
  return next;
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
