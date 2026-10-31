import { execFileSync } from 'node:child_process';
import { shellWrapped } from './launch-env';

// Leave space for the kernel envelope and shell startup metadata. Shell rc can add
// arbitrary data later; this checks the exact payload owned by the application.
export const LAUNCH_HEADROOM = 32 * 1024;
let cachedLimit: number | null | undefined;
export function launchArgMax(): number | null {
  if (cachedLimit !== undefined) return cachedLimit;
  try {
    const raw = execFileSync('/usr/bin/getconf', ['ARG_MAX'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 1000, maxBuffer: 128, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    return cachedLimit = Number.isSafeInteger(value) && value > LAUNCH_HEADROOM ? value : null;
  } catch { return cachedLimit = null; }
}
export interface LaunchPayload { command: string; args: string[]; scriptArgs?: string[]; env: Record<string, string> }
/** Values stay in memory; only aggregate byte counts may be recorded. */
export function launchPayloadBytes(payload: LaunchPayload): number {
  const wrapped = shellWrapped(payload.command, payload.args, payload.scriptArgs);
  const strings = [wrapped.file, ...wrapped.args, ...Object.entries(payload.env).map(([key, value]) => key + '=' + value)];
  let bytes = 8 * (strings.length + 2); // conservative 64-bit argv/envp pointers, including terminators
  for (const value of strings) {
    if (value.includes('\0')) throw new Error('启动参数或环境变量包含无效字符');
    bytes += Buffer.byteLength(value, 'utf8') + 1;
  }
  return bytes;
}
export function launchPayloadFits(payload: LaunchPayload, limit: number | null): boolean {
  const bytes = launchPayloadBytes(payload);
  return limit === null || bytes + LAUNCH_HEADROOM <= limit;
}
